import bcrypt from "bcryptjs";

export const authController = {
  async login(req, res) {
    const user = req.body;
    const ok = await bcrypt.compare(user.password, "stored-hash");
    res.json({ ok });
  },
};
