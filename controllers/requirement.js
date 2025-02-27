const Requirement = require("../models/requirement");
const { paginationInstance } = require("../utils/pagination");

exports.getAllRrequirements = async (req, res) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      Requirement.collection
    );
    const { startIndex, query, limit } = options;
    const requirements = await Requirement.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: requirements };
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.createRequirement = async (req, res) => {
  try {
    const requirement = await Requirement.create(req.body);
    res.status(200).json({
      status: "success",
      data: requirement,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.updateRequirement = async (req, res) => {
  try {
    const mComment = await Requirement.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.status(200).json({
      status: "success",
      mComment,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

exports.deleteRequirement = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedRequirement = await Requirement.findByIdAndDelete(id);

    if (!deletedRequirement) {
      return res.status(404).json({
        status: "failed",
        message: "Requirement not found",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Requirement deleted successfully",
      deletedRequirement,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
