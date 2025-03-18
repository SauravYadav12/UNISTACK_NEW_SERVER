const Consultant = require("../models/consultant");
const { paginationInstance } = require("../utils/pagination");
const { sequenceId } = require("../utils/utils");
exports.getAllConsultants = async (req, res) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      Consultant
    );
    const { startIndex, query, limit } = options;
    const consultant = await Consultant.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...instance, results: consultant };
    res.status(200).json({
      status: "success",
      data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.createConsultant = async (req, res) => {
  try {
    req.body.consultantId = await sequenceId(Consultant, "consultantId", "CON");
    const consultant = await Consultant.create(req.body);
    res.status(200).json({
      status: "success",
      data: consultant,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({
      status: "failed",
    });
  }
};

exports.updateConsultant = async (req, res) => {
  try {
    const id = req.params.id;
    const data = await Consultant.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!data) {
      return res.status(404).json({
        status: "failed",
        message: "Consultant not found",
      });
    }
    res.status(200).json({
      status: "success",
      data: data,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};

exports.deleteConsultant = async (req, res) => {
  try {
    const id = req.params.id;
    const deleteConsultant = await Consultant.findByIdAndDelete(id);
    if (!deleteConsultant) {
      return res.status(404).json({
        status: "failed",
        message: "Consultant not found",
      });
    }
    res.status(200).json({
      status: "success",
      message: "Consultant deleted successfully",
      deleteConsultant,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      error: error.message,
    });
  }
};
