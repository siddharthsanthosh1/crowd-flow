// Stands in for the re2js package (about 140 KB) via the alias in vite.config.ts.
//
// Firestore imports re2js only to evaluate regex and LIKE expressions in Pipeline
// queries on the client. CrowdFlow runs no Pipeline queries, and every place
// Firestore calls compile() is inside a try/catch, so if one were ever reached the
// expression would evaluate to an error and log a warning - never a crash.
export const RE2JS = {
  compile(): never {
    throw new Error('re2js is not bundled in CrowdFlow')
  },
}
