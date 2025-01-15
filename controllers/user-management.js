const User = require("../models/user");

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({});
    res.status(200).json({
      status: "success",
      users
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error
    });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {new: true});
    res.status(200).json({
      status: "success",
      user
    })
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error
    })
  }
}
