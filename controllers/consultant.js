const Consultant = require("../models/consultant")

exports.getAllConsultants = async (req, res) => {
    try {
        // console.log(req.query)
        const consultant = await Consultant.find()
        res.status(200).json({
            status: "success",
            data: consultant
        })
    } catch (error) {
        res.status(400).json({
            status: "failed"
        })
    }
}

exports.createConsultant = async (req, res) => {
    try {
        const lastConsultant = await Consultant.findOne().sort({ consultantId: -1 });
        const newConsultantId = lastConsultant ? lastConsultant.consultantId + 1 : 1;
        req.body.consultantId = newConsultantId;
        const consultant = await Consultant.create(req.body)
        // console.log("Body", req.body)
        res.status(200).json({
            status: "success",
            data: consultant
        })
    } catch (error) {
        console.log(error)
        res.status(400).json({
            status: "failed"
        })
    }
}

exports.updateConsultant = async (req, res) => {
    try {
      const id = req.params.id;
    //   console.log("Incoming UPDATE request ID:", id);
      const data = await Consultant.findByIdAndUpdate(req.params.id, req.body, {new: true});
    //   console.log(req.params.id)
      if (!data) {
        return res.status(404).json({
          status: "failed",
          message: "Consultant not found",
        });
      }
      res.status(200).json({
        status: "success",
        data: data
      })
    } catch (error) {
      res.status(400).json({
        status: "failed",
        error
      })
    }
  }

  exports.deleteConsultant = async (req, res) => {
    try {
        const id = req.params.id;
        const deleteConsultant = await Consultant.findByIdAndDelete(id);
        if (!deleteConsultant) {
          return res.status(404).json({
            status: "failed", 
            message: "Consultant not found" 
        });
        }
        res.status(200).json({
            status: "success",
             message: "Consultant deleted successfully",
             deleteConsultant
            });
      } catch (error) {
        res.status(500).json({ 
            status: "failed",
            error: error.message, 
        });
      }
  }