const { Op } = require("sequelize");

function translateWhere(mongoFilter = {}) {
  if (!mongoFilter || typeof mongoFilter !== "object") return {};
  const where = {};

  for (const [k, v] of Object.entries(mongoFilter)) {
    if (k === "$or" && Array.isArray(v)) {
      where[Op.or] = v.map(translateWhere);
    } else if (k === "$and" && Array.isArray(v)) {
      where[Op.and] = v.map(translateWhere);
    } else if (k === "_id") {
      where.id = v;
    } else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const cond = {};
      if (v.$in !== undefined) cond[Op.in] = v.$in;
      if (v.$nin !== undefined) cond[Op.notIn] = v.$nin;
      if (v.$ne !== undefined) cond[Op.ne] = v.$ne;
      if (v.$gte !== undefined && v.$lte !== undefined) {
        cond[Op.gte] = v.$gte;
        cond[Op.lte] = v.$lte;
      } else {
        if (v.$gte !== undefined) cond[Op.gte] = v.$gte;
        if (v.$lte !== undefined) cond[Op.lte] = v.$lte;
        if (v.$gt !== undefined) cond[Op.gt] = v.$gt;
        if (v.$lt !== undefined) cond[Op.lt] = v.$lt;
      }
      if (v.$exists !== undefined) {
        if (v.$exists) cond[Op.ne] = null;
        else cond[Op.is] = null;
      }
      where[k] = cond;
    } else {
      where[k] = v;
    }
  }

  return where;
}

function unwrapRow(r) {
  if (!r) return null;
  const raw = typeof r.get === "function" ? r.get({ plain: true }) : { ...r };
  let base = {};
  if (raw.data) {
    base = typeof raw.data === "string" ? JSON.parse(raw.data) : { ...raw.data };
  }
  const out = { ...base, ...raw };
  delete out.data;
  if (out.isDeleted !== undefined) out.isDeleted = Boolean(out.isDeleted);
  if (out.isOpen !== undefined) out.isOpen = Boolean(out.isOpen);
  if (out.isVerified !== undefined) out.isVerified = Boolean(out.isVerified);
  return out;
}

function attachCompat(model) {
  if (model._hasSqlCompat) return model;
  model._hasSqlCompat = true;

  const nativeFindOne = model.findOne.bind(model);
  const nativeFindAll = model.findAll.bind(model);

  model.find = function (filter = {}, projection = {}) {
    const where = translateWhere(filter);
    const execute = async () => {
      const rows = await nativeFindAll({ where });
      return rows.map(unwrapRow);
    };
    const chainable = {
      lean: execute,
      select: () => chainable,
      sort: () => chainable,
      skip: () => chainable,
      limit: () => chainable,
      exec: execute,
      then: (resolve, reject) => execute().then(resolve, reject)
    };
    return chainable;
  };

  model.findOne = function (filter = {}) {
    if (filter && filter.where) {
      return nativeFindOne(filter);
    }
    const where = translateWhere(filter);
    let order = undefined;

    const execute = async () => {
      const row = await nativeFindOne({ where, order });
      return unwrapRow(row);
    };

    const chainable = {
      lean: execute,
      select: () => chainable,
      sort: (sortObj) => {
        if (sortObj && typeof sortObj === "object") {
          const entries = Object.entries(sortObj);
          if (entries.length > 0) {
            const [field, dir] = entries[0];
            const cleanField = field.includes(".") ? field.split(".").pop() : field;
            order = [[cleanField, dir === -1 || dir === "desc" ? "DESC" : "ASC"]];
          }
        }
        return chainable;
      },
      exec: execute,
      then: (resolve, reject) => execute().then(resolve, reject)
    };
    return chainable;
  };

  model.findById = function (id) {
    const execute = async () => {
      const row = await model.findByPk(id);
      return unwrapRow(row);
    };
    const chainable = {
      select: () => chainable,
      lean: execute,
      exec: execute,
      then: (resolve, reject) => execute().then(resolve, reject)
    };
    return chainable;
  };

  model.deleteMany = async function (filter = {}) {
    const where = translateWhere(filter);
    return model.destroy({ where, truncate: Object.keys(where).length === 0 });
  };

  model.countDocuments = async function (filter = {}) {
    const where = translateWhere(filter);
    return model.count({ where });
  };

  model.updateMany = async function (filter = {}, update = {}) {
    const where = translateWhere(filter);
    const patch = update.$set ? { ...update.$set } : { ...update };
    delete patch.$inc;
    return model.update(patch, { where });
  };

  model.updateOne = async function (filter = {}, update = {}, options = {}) {
    const where = translateWhere(filter);
    const patch = update.$set ? { ...update.$set } : { ...update };
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        patch[k] = (patch[k] || 0) + v;
      }
    }
    if (options && options.upsert) {
      return model.upsert({ ...where, ...patch });
    }
    return model.update(patch, { where });
  };

  model.findOneAndUpdate = function (filter = {}, update = {}, options = {}) {
    const where = translateWhere(filter);
    const patch = update.$set ? { ...update.$set } : { ...update };
    const execute = async () => {
      let doc = await nativeFindOne({ where });
      if (!doc && options.upsert) {
        doc = await model.create({ ...where, ...patch });
      } else if (doc) {
        await doc.update(patch);
      }
      return unwrapRow(doc);
    };
    return {
      lean: execute,
      exec: execute,
      then: (resolve, reject) => execute().then(resolve, reject)
    };
  };

  return model;
}

module.exports = {
  attachCompat,
  translateWhere,
  unwrapRow
};
