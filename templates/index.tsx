import { render } from "@react-email/components";
import { ILeave } from "../interface";
import { LeaveRequestEmail } from "./email/LeaveRequest";
import React from "react";
import LeaveStatusEmail from "./email/LeaveStatus";
import HolidayNoticeEmail, { HolidayNoticeVariables } from "./email/HolidayNotice";
import GenericNoticeEmail, { GenericNoticeVariables } from "./email/GenericNotice";
import {
  OnboardingInviteEmail,
  OnboardingInviteProps,
  OnboardingInfoRequestEmail,
  OnboardingInfoRequestProps,
  BgCheckStartedEmail,
  BgCheckStartedProps,
  OfferLetterEmail,
  OfferLetterEmailProps,
  OfferAcceptedEmail,
  OfferAcceptedEmailProps,
  OnboardingRejectedEmail,
  OnboardingRejectedEmailProps,
} from "./email/OnboardingEmails";

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

// ── Onboarding email render wrappers ────────────────────────────────

export function getOnboardingInviteTemplate(p: OnboardingInviteProps) {
  return render(<OnboardingInviteEmail {...p} />);
}

export function getOnboardingInfoRequestTemplate(
  p: OnboardingInfoRequestProps,
) {
  return render(<OnboardingInfoRequestEmail {...p} />);
}

export function getBgCheckStartedTemplate(p: BgCheckStartedProps) {
  return render(<BgCheckStartedEmail {...p} />);
}

export function getOfferLetterTemplate(p: OfferLetterEmailProps) {
  return render(<OfferLetterEmail {...p} />);
}

export function getOfferAcceptedTemplate(p: OfferAcceptedEmailProps) {
  return render(<OfferAcceptedEmail {...p} />);
}

export function getOnboardingRejectedTemplate(p: OnboardingRejectedEmailProps) {
  return render(<OnboardingRejectedEmail {...p} />);
}