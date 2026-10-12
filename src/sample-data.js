export const sourceUrl = 'https://www.careratings.com/upload/CompanyFiles/PR/202506130648_Indian_Renewable_Energy_Development_Agency_Limited.pdf';
const common = { documentIssuerId: 'ireda', publishedAt: '2025-06-23', firstSeenAt: '2026-10-11T11:00:00Z', sourceUrl, sourceTitle: 'CareEdge — IREDA revised rating rationale', historical: true, extractionMethod: 'Human-curated historical source', status: 'candidate' };
export const sampleData = {
  entities: [
    { id:'gensol', name:'Gensol Engineering Limited', aliases:['Gensol Engineering','Gensol'], role:'Borrower mentioned in disclosure' },
    { id:'ireda', name:'Indian Renewable Energy Development Agency Limited', aliases:['IREDA'], role:'Lender / rated entity' },
    { id:'ireda-ifsc', name:'IREDA Global Green Energy Finance IFSC Limited', aliases:[], role:'Subsidiary' },
  ],
  events: [
    {...common, id:'gensol-governance-2025', entityId:'gensol', type:'governance_concern', title:'Borrower investigations noted by rating agency', summary:'The June 2025 report attributes investigations and allegations to Gensol, not to every company mentioned in the document. Allegations are not independent legal findings.', eventDate:'2025-04-01', eventDatePrecision:'month', page:3, quote:'CareEdge Ratings also notes that IREDA is one of the financiers for Gensol Engineering (Gensol), which has been embroiled in multiple investigations and legal actions since April 2025, primarily due to allegations of fund diversion and corporate governance lapses.'},
    {...common, id:'gensol-npa-expectation-2025', entityId:'gensol', type:'expected_npa', title:'Historical expectation of borrower NPA slippage', summary:'CareEdge expected Gensol slippage into NPA in H1 FY2026. This is the source’s historical expectation; it does not establish current account classification or realized loss.', eventDate:'2025-06-23', page:1, quote:'CareEdge Ratings expects the gross NPA to increase in H1 FY2026 on account of expected slippage of Gensol Engineering (Gensol) into NPA category.'},
    {...common, id:'ireda-redeemed-instrument-2025', entityId:'ireda', type:'redemption', title:'Withdrawal following redemption — not a downgrade', summary:'The instrument-specific withdrawal followed redemption. Other listed IREDA bond ratings were reaffirmed at CARE AAA; Stable in the page 1 table. Do not apply the borrower’s risk event to IREDA.', eventDate:'2025-06-23', page:1, quote:'The above action has been taken, owing to redemption of the said ISIN of IREDA and as per CARE Ratings\' policy on withdrawal of ratings.'},
  ],
  relationships: [
    {id:'ireda-finances-gensol',sourceId:'ireda',targetId:'gensol',type:'finances',sourceUrl,sourceTitle:'CareEdge — IREDA, page 3',page:3,quote:'CareEdge Ratings also notes that IREDA is one of the financiers for Gensol Engineering (Gensol)',asOf:'2025-03-31',amount:'7289500000.00',currency:'INR',approximate:true,amountLabel:'Published historical account outstanding; not your imported position'},
    {id:'ireda-subsidiary-ifsc',sourceId:'ireda',targetId:'ireda-ifsc',type:'parent_of',sourceUrl,sourceTitle:'CareEdge — IREDA, page 2',page:2,quote:'CareEdge Ratings has changed its approach from ‘Standalone’ to ‘Consolidated’ for IREDA owing to the financial and operational linkages with its subsidiary – IREDA Global Green Energy Finance IFSC Limited.',asOf:'2025-06-23',amount:null,currency:null},
  ],
  reviews: [], runs: [],
};
// Illustrative analyst positions, NOT actual holdings or the published lender account.
export const SAMPLE_CSV = 'position_id,entity_id,currency,amount,as_of\nSAMPLE-001,gensol,INR,1250000.00,2025-03-31\nSAMPLE-002,ireda,INR,500000.00,2025-03-31\nSAMPLE-003,gensol,USD,1200.50,2025-03-31\n';
