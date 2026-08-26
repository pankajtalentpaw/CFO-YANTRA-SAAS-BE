const express = require("express");
const router = express.Router();
const cloudController = require("../controllers/cloudController");

router.get("/status", cloudController.getCloudStatus);

module.exports = router;
