import { render } from "@react-email/components";
import { ILeave } from "../interface";
import { LeaveRequestEmail } from "./email/LeaveRequest";
import React from "react";
import LeaveStatusEmail from "./email/LeaveStatus";
import HolidayNoticeEmail, { HolidayNoticeVariables } from "./email/HolidayNotice";
import GenericNoticeEmail, { GenericNoticeVariables } from "./email/GenericNotice";

export function getLeaveRequestTemplate(leave: ILeave) {
    return render(<LeaveRequestEmail leave={leave} />);
}

export function getLeaveStatusTemplate(leave: ILeave) {
    return render(<LeaveStatusEmail leave={leave} />);
}

export function getHolidayNoticeTemplate(vars: HolidayNoticeVariables) {
    return render(<HolidayNoticeEmail vars={vars} />);
}

export function getGenericNoticeTemplate(vars: GenericNoticeVariables) {
    return render(<GenericNoticeEmail vars={vars} />);
}