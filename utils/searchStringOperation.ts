import { MongooseQueryOptions } from "mongoose";
import { myDate } from "./dateUtil";
import moment from "moment";
import { stringDateFormate } from "./utils";

const dateFields = ["createdAt", "updatedAt"];
const stringTypeDateFields = ["interviewDate"];

export function handleSearchString(
  query: Record<string, unknown>,
  searchFields: string[],
) {
  const extractVal = (val: unknown) => {
    if (typeof val === "string") return val;
    if (Array.isArray(val)) return val;
    return [];
  };
  const orQueries: MongooseQueryOptions[] = [];
  let searchString: string[] | string = extractVal(query.searchString);
  const qSearchFields: string[] | string | undefined = extractVal(
    query.searchField,
  );
  let caseInsensitiveFields: string[] | string = extractVal(
    query.caseInsensitiveFields,
  );

  searchString = Array.isArray(searchString) ? searchString : [searchString];

  caseInsensitiveFields = Array.isArray(caseInsensitiveFields)
    ? caseInsensitiveFields
    : [caseInsensitiveFields];

  if (qSearchFields?.length) {
    searchFields = Array.isArray(qSearchFields)
      ? qSearchFields
      : [qSearchFields];
  }

  function applyQuery(
    field: string,
    val: string,
    options?: {
      caseInsensitiveExactMatch: boolean;
    },
  ) {
    if (dateFields.includes(field)) {
      const { from, to } = myDate(val, val);
      orQueries.push({
        [field]: {
          $gte: from,
          $lte: to,
        },
      });
    } else if (stringTypeDateFields.includes(field)) {
      orQueries.push({
        [field]: moment(val).format(stringDateFormate),
      });
    } else {
      if (options?.caseInsensitiveExactMatch) {
        orQueries.push({ [field]: { $regex: `^${val}$`, $options: "i" } });
      } else {
        orQueries.push({ [field]: { $regex: val, $options: "i" } });
      }
    }
  }

  searchString.forEach((val) => {
    searchFields.forEach((field) => {
      applyQuery(field, val);
    });
  });

  caseInsensitiveFields.forEach((field) => {
    if (field in query && typeof query[field] === "string") {
      applyQuery(field, query[field], { caseInsensitiveExactMatch: true });

      delete query[field];
    }
  });

  if (orQueries.length) {
    query.$or = orQueries;
  }

  delete query.searchString;
  delete query.searchField;
  delete query.caseInsensitiveFields;

  return query;
}

const commonIntFields = [
  "interviewStatus",
  "consultant",
  "interviewTime",
  "intResult",
  "subjectLine",
  "clientName",
  "jobTitle",
  "candidateName",
  "marketingPerson",
];

export const searchableFields = {
  interview: ["intId", ...commonIntFields],
  vendorInterview: ["testID", ...commonIntFields],
  requirement: [
    "reqID",
    "reqStatus",
    "appliedFor",
    "assignedTo",
    "clientCompany",
    "nextStep",
    "vendorCompany",
    "vendorPersonName",
    "vendorPhone",
    "jobTitle",
    "reqEnteredBy",
  ],
  consultant: [
    "consultantId",
    "consultantStatus",
    "consultantName",
    "psuedoName",
    "visaStatus",
    "degree",
    "yearPassing",
    "university",
    "createdBy",
  ],
  team: ["teamId", "teamName", "teckStack", "developerName", "createdBy"],
  salesLead: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "assignedTo",
    "status",
    "country",
    "city",
  ],
};
