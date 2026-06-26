const logger = (req, _res, next) => {
  console.log(req.method, req.url);
  next();
};

export default logger;
