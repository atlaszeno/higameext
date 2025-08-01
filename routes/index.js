const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");

/* GET home page. */
router.get("/", function (req, res, next) {
  res.send({ success: true, message: "Hey!" });
});

router.use(
  "*",
  asyncHandler((req, res, next) => {
    console.error(`404 Error: Pathname ${req.path} does not exist`);
    return res.status(404).json({
      success: false,
      message: `404 Pathname ${req.path} does not exist!`,
    });
  })
);

module.exports = router;
