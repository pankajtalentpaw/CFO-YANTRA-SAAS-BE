const express = require("express");
const router = express.Router();
const cloudController = require("../controllers/cloud.controller");

router.get("/status", cloudController.getCloudStatus);

module.exports = router;
