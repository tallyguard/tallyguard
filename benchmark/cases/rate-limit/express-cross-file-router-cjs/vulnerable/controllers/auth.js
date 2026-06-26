const bcrypt = require("bcryptjs");

exports.login = async (req, res) => {
  const ok = await bcrypt.compare(req.body.password, "stored-hash");
  res.json({ ok });
};
