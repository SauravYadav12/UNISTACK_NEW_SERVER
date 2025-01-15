export interface UserProfile extends MyDocuments {
  employeeId: string;
  name: string;
  photo: string;
  email: ProfileEmail;
  dob: string;
  phoneNumber: string;
  emergencyPhoneNumber: string;
  panNumber: string;
  aadharNumber: string;
  bankDetails: BankDetails;
  communicationAddress: CommunicationAddress;
  permanentAddress: PermanentAddress;
}

export interface MyDocuments {
  panCopy: string;
  aadharCopy: string;
  resume: string;
}

export type CommunicationAddress = Address;
export type PermanentAddress = Address;
interface Address {
  address1: string;
  address2: string;
  country: string;
  state: string;
  city: string;
  "zip/pin": string;
}
export interface BankDetails {
  accountName: string;
  accountNumber: string;
  bankName: string;
  ifscCode: string;
  swiftCode: string;
  bankAddress: string;
}

export interface ProfileEmail {
  personal: string;
  official: string;
}
