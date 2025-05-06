interface RegexQueries {
  [x: string]: {
    $regex: string;
    $options: string;
  };
}

export function handleSearchString(query: any, searchFields: string[]) {
  let searchString: string[] | string | undefined = query.searchString;
  let qSearchFields: string[] | string | undefined = query.searchField;

  if (!searchString || !searchString.length) return query;

  searchString = Array.isArray(searchString) ? searchString : [searchString];

  if (qSearchFields?.length) {
    searchFields = Array.isArray(qSearchFields)
      ? qSearchFields
      : [qSearchFields];
  }

  const orQueries: RegexQueries[] = [];

  searchString.forEach((val) => {
    const regexQueries = searchFields.map((field) => ({
      [field]: { $regex: val, $options: "i" },
    }));
    orQueries.push(...regexQueries);
  });

  query.$or = orQueries;
  delete query.searchString;
  delete query.searchField;

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
  team: ["teamId", "teamName", "contactPerson", "phone", "createdBy"],
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
