import { render } from "@react-email/components";
import { ILeave } from "../interface";
import { LeaveRequestEmail } from "./email/LeaveRequest";
import React from "react";
import LeaveStatusEmail from "./email/LeaveStatus";

export function getLeaveRequestTemplate(leave: ILeave) {
    return render(<LeaveRequestEmail leave={leave} />);
}

export function getLeaveStatusTemplate(leave: ILeave) {
    return render(<LeaveStatusEmail leave={leave} />);
}