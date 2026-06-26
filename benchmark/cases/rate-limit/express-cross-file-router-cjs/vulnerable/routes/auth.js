const express = require("express");
const authController = require("../controllers/auth");

const router = express.Router();

// The handler is a CommonJS controller method in another file (bcrypt.compare lives there).
router.post("/login", authController.login);

module.exports = router;
