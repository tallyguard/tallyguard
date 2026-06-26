const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
router.post("/login", async (req, res) => {
  const ok = await bcrypt.compare(req.body.password, "stored-hash");
  res.json({ ok });
});
module.exports = router;
