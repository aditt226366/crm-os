export type SourceCampaignKey = "UG_JULY_2026" | "MBA_JULY_2026";

export type SourceCampaignStepDefinition = {
  stepNumber: number;
  delayDays: number;
  body: string;
};

export type SourceCampaignDefinition = {
  key: SourceCampaignKey;
  name: string;
  sourceSheet: string;
  steps: SourceCampaignStepDefinition[];
};

export const SOURCE_CAMPAIGN_DEFINITIONS: SourceCampaignDefinition[] = [
  {
    key: "UG_JULY_2026",
    name: "V9 UG July 2026 Follow-up",
    sourceSheet: "UG Leads",
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        body: `Hi {{name}} 👋

Your 12th results don't have to decide your future. There's still a way into a recognised online degree — this July itself.

At V9 Education, we'll shortlist the right UGC-entitled program for you based on your results and interests — our counselling is completely free, no commitment needed.

Which stream did you study in 12th — Science, Commerce or Arts?`
      },
      {
        stepNumber: 2,
        delayDays: 3,
        body: `Hi {{name}}, still here if you need guidance 👋

Missing a college seat doesn't mean missing a degree.

Here's what V9 offers:

✅ 30+ recognised universities
✅ 100% admission success rate
✅ Free counselling — zero pressure

July admissions are closing soon.

Reply "DEGREE" and we'll find your best option today.`
      },
      {
        stepNumber: 3,
        delayDays: 5,
        body: `Hi {{name}}, this is the last reminder 👋

July batch closes this week.

After this, you'll have to wait months for the next admission window.

Don't lose another year.

One free call with a V9 counsellor gets you enrolled this month itself.

Reply "YES" to book your slot now.`
      }
    ]
  },
  {
    key: "MBA_JULY_2026",
    name: "V9 Online MBA July 2026 Follow-up",
    sourceSheet: "Online MBA Leads",
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        body: `Hi {{name}} 👋

You're looking to grow beyond ₹4 LPA with an online MBA — smart move.

At V9 Education, we'll shortlist the right UGC-entitled MBA for you based on your background — our counselling is completely free, no commitment needed.

Can I ask — are you currently working? Which field are you in?`
      },
      {
        stepNumber: 2,
        delayDays: 3,
        body: `Hi {{name}}, just checking in 👋

Still thinking about your online MBA?

Here's why 2,000+ professionals chose V9:

✅ 30+ UGC-entitled universities
✅ Study while you work — no career break
✅ Admitted in days, not months

July batch is filling up.

Reply "MBA" and we'll find your best option today.`
      },
      {
        stepNumber: 3,
        delayDays: 5,
        body: `Hi {{name}}, last reminder 👋

July admissions close this week.

After this, next batch is months away.

One free call with our counsellor = your MBA shortlisted, fees compared, admission started.

Reply "YES" to book your free counselling slot now.`
      }
    ]
  }
];

function normalizeSourceSheet(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() ?? "";
}

const sourceSheetCampaignMap = new Map(
  SOURCE_CAMPAIGN_DEFINITIONS.map((definition) => [normalizeSourceSheet(definition.sourceSheet), definition])
);

export function sourceCampaignForSheet(sourceSheet: string | null | undefined) {
  return sourceSheetCampaignMap.get(normalizeSourceSheet(sourceSheet)) ?? null;
}

export function isSourceCampaignSheet(sourceSheet: string | null | undefined) {
  return Boolean(sourceCampaignForSheet(sourceSheet));
}

export function canonicalSourceSheetName(sourceSheet: string | null | undefined) {
  return sourceCampaignForSheet(sourceSheet)?.sourceSheet ?? sourceSheet?.trim() ?? null;
}
