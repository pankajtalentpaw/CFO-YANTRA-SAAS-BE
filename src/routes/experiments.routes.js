const express = require("express");
const router = express.Router();
const experimentsController = require("../controllers/experiments.controller");

router.get("/", experimentsController.getExperiments);
router.get("/01", experimentsController.getExperiment01);
router.get("/02", experimentsController.getExperiment02);
router.get("/03", experimentsController.getExperiment03);
router.get("/04", experimentsController.getExperiment04);
router.get("/05", experimentsController.getExperiment05);
router.get("/06", experimentsController.getExperiment06);
router.get("/07", experimentsController.getExperiment07);
router.get("/08", experimentsController.getExperiment08);
router.get("/09", experimentsController.getExperiment09);
router.get("/10", experimentsController.getExperiment10);

module.exports = router;
