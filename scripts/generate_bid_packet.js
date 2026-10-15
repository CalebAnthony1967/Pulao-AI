import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";

function createBidPacket() {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;

  // Helper colors
  const primaryNavy = [15, 23, 42]; // #0f172a
  const accentBlue = [2, 132, 199]; // #0284c7
  const borderGray = [226, 232, 240];
  const textDark = [30, 41, 59];
  const textMuted = [100, 116, 139];
  const bgLight = [248, 250, 252];
  const successGreen = [22, 101, 52];

  function drawHeader(pageNum, totalPages, title) {
    // Top bar
    doc.setFillColor(...primaryNavy);
    doc.rect(margin, 12, contentWidth, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...textMuted);
    doc.text("REPUBLIC OF KENYA • PUBLIC PROCUREMENT TENDER SUBMISSION", margin, 18);
    doc.text("CONFIDENTIAL BID DOSSIER", pageWidth - margin, 18, { align: "right" });

    // Footer
    doc.setDrawColor(...borderGray);
    doc.line(margin, pageHeight - 16, pageWidth - margin, pageHeight - 16);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...textMuted);
    doc.text(
      "Tender Ref: T-2026-KEBS-014 • Apex Sovereign Technologies Ltd (Reg: PVT-2024-889911)",
      margin,
      pageHeight - 11
    );
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, pageHeight - 11, { align: "right" });
  }

  // ==========================================
  // PAGE 1: FORM OF TENDER & SUBMISSION LETTER
  // ==========================================
  drawHeader(1, 4, "TENDER SUBMISSION");

  // Company Brand Box
  doc.setFillColor(...bgLight);
  doc.setDrawColor(...borderGray);
  doc.roundedRect(margin, 24, contentWidth, 32, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...primaryNavy);
  doc.text("APEX SOVEREIGN TECHNOLOGIES LIMITED", margin + 6, 32);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...textDark);
  doc.text("Incorporated in the Republic of Kenya • Company Reg No: PVT-2024-889911", margin + 6, 38);
  doc.text("KRA PIN: P051928374A • AGPO Registration: AGPO-YTH-2026-01 (Youth Category)", margin + 6, 43);
  doc.text("Upper Hill Financial Plaza, 7th Floor, Ralph Bunche Road, P.O. Box 48291 - 00100 Nairobi", margin + 6, 48);
  doc.text("Email: tenders@apexsovereign.co.ke • Tel: +254 (0) 20 789 4400 / +254 712 345 678", margin + 6, 53);

  // Date and Addressee
  let y = 64;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...textDark);
  doc.text("DATE: 14th November 2026", margin, y);
  y += 6;

  doc.text("TO:", margin, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text("The Secretary / Head of Supply Chain Management", margin, y);
  y += 4.5;
  doc.text("Kenya Education Board Services (KEBS)", margin, y);
  y += 4.5;
  doc.text("National Headquarters, Harambee Avenue", margin, y);
  y += 4.5;
  doc.text("P.O. Box 30120 - 00100, Nairobi, Kenya", margin, y);
  y += 8;

  // Tender Title Box
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, contentWidth, 16, "F");
  doc.setDrawColor(...accentBlue);
  doc.setLineWidth(0.8);
  doc.line(margin, y, margin, y + 16);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...primaryNavy);
  doc.text("SUBJECT: FORM OF TENDER & BID SUBMISSION PACKET", margin + 4, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    "Tender Ref No: T-2026-KEBS-014 — Supply and Delivery of Desktop Computers and Network Switches",
    margin + 4,
    y + 11
  );
  y += 22;

  // Body text
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...textDark);
  const letterBody = [
    "Dear Sir / Madam,",
    "",
    "1. In accordance with the Instructions to Tenderers and Specifications for Tender Ref: T-2026-KEBS-014, we the undersigned, offer to supply, deliver, install, test, and commission eighty (80) Desktop Computers, eighty (80) 4K Monitors, twenty (20) 24-Port Managed PoE+ Network Switches, and associated Structured Cabling in full conformity with the tender conditions.",
    "",
    "2. We hereby lodge our total financial quotation in the sum of Kenya Shillings Twelve Million Two Hundred and Forty Thousand Only (KES 12,240,000.00), inclusive of all applicable statutory taxes, transport, delivery, and 12-month manufacturer warranty.",
    "",
    "3. We confirm that this quotation remains valid and binding for a period of one hundred and twenty (120) calendar days from the tender closing date, and may be accepted at any time before the expiration of that period.",
    "",
    "4. We enclose herewith all mandatory preliminary statutory documents, tax clearance certificates, company registration filings, social security and health declarations, and pricing schedules as mandated under Section 79(1) of the Public Procurement and Asset Disposal Act, 2015."
  ];

  for (const line of letterBody) {
    if (line === "") {
      y += 3;
    } else {
      const split = doc.splitTextToSize(line, contentWidth);
      doc.text(split, margin, y);
      y += split.length * 4.2;
    }
  }

  y += 6;

  // Signature Block
  doc.setDrawColor(...borderGray);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primaryNavy);
  doc.text("FOR AND ON BEHALF OF THE TENDERER:", margin, y);
  y += 10;

  // Two columns for signatures
  const colWidth = (contentWidth - 10) / 2;

  // MD Signature
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("Dr. Grace W. Nyambura, PhD, OGW", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...textMuted);
  doc.text("Managing Director & Chief Executive Officer", margin, y + 4);
  doc.text("National ID No: 24891032", margin, y + 8);
  doc.text("Signed: __________________________  Date: 14/11/2026", margin, y + 14);

  // Secretary Signature
  const col2X = margin + colWidth + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primaryNavy);
  doc.text("Adv. Edwin K. Kiprop (CPS, Advocate)", col2X, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...textMuted);
  doc.text("Company Secretary & Legal Counsel", col2X, y + 4);
  doc.text("Practicing Cert No: LSK/2026/8812", col2X, y + 8);
  doc.text("Signed: __________________________  Date: 14/11/2026", col2X, y + 14);

  // Seal box
  doc.setDrawColor(...borderGray);
  doc.roundedRect(margin, y + 20, contentWidth, 12, 1, 1);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(...textMuted);
  doc.text("[OFFICIAL COMMON SEAL OF APEX SOVEREIGN TECHNOLOGIES LTD AFFIXED HEREWITH]", pageWidth / 2, y + 27, { align: "center" });

  // ==========================================
  // PAGE 2: STATUTORY COMPLIANCE REGISTERS
  // ==========================================
  doc.addPage();
  drawHeader(2, 4, "STATUTORY COMPLIANCE CREDENTIALS");

  y = 25;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...primaryNavy);
  doc.text("SECTION 2: MANDATORY STATUTORY COMPLIANCE SCHEDULE", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...textMuted);
  doc.text(
    "Verified against live government registers under PPADA 2015 Section 79(1) preliminary evaluation requirements.",
    margin,
    y
  );
  y += 8;

  const certificates = [
    {
      title: "1. Kenya Revenue Authority (KRA) Tax Compliance Certificate",
      certNumber: "KRA-TAX-2026-99182",
      portal: "iTax Portal / National Tax Register",
      issued: "01 October 2025",
      validThrough: "31 October 2027",
      status: "VALID & COMPLIANT",
      notes: "PIN P051928374A is fully active with zero tax arrears. Valid for all public tender awards.",
    },
    {
      title: "2. Business Registration Service (BRS) Certificate of Incorporation",
      certNumber: "BRS-INC-883921 / PVT-2024-889911",
      portal: "Companies Registry (eCitizen BRS Service)",
      issued: "15 January 2021",
      validThrough: "Perpetual (Annual Return 2026 Lodged)",
      status: "ACTIVE COMPANY IN GOOD STANDING",
      notes: "Private Limited Company incorporated under the Companies Act, 2015. 100% Kenyan citizen ownership.",
    },
    {
      title: "3. National Social Security Fund (NSSF) Compliance Certificate",
      certNumber: "NSSF-EMP-55210",
      portal: "NSSF Employer Self-Service Portal",
      issued: "01 November 2025",
      validThrough: "30 November 2027",
      status: "FULLY COMPLIANT (ZERO ARREARS)",
      notes: "Tier I and Tier II statutory pensions remitted for 42 regular staff members up to current period.",
    },
    {
      title: "4. Social Health Authority (SHA / SHIF) Employer Clearance",
      certNumber: "SHA-SHIF-99102",
      portal: "Social Health Authority Statutory Portal",
      issued: "10 October 2025",
      validThrough: "31 December 2027",
      status: "ACTIVE & FULLY CURRENT",
      notes: "Health insurance contributions remitted for all staff in accordance with Social Health Insurance Act 2023.",
    },
    {
      title: "5. National Treasury AGPO Certificate (Youth Enterprise Preference)",
      certNumber: "AGPO-YTH-2026-01",
      portal: "Public Procurement Regulatory Authority / National Treasury",
      issued: "02 February 2026",
      validThrough: "01 February 2028",
      status: "CERTIFIED YOUTH-OWNED ENTERPRISE",
      notes: "Qualifies under 30% affirmative procurement allocation (PPADA 2015 s.53(6) & Legal Notice No. 114).",
    },
  ];

  certificates.forEach((c) => {
    doc.setFillColor(...bgLight);
    doc.setDrawColor(...borderGray);
    doc.roundedRect(margin, y, contentWidth, 31, 2, 2, "FD");

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...primaryNavy);
    doc.text(c.title, margin + 4, y + 6);

    // Badge
    doc.setFillColor(220, 252, 231); // green soft
    doc.roundedRect(pageWidth - margin - 52, y + 2.5, 48, 5.5, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...successGreen);
    doc.text(c.status, pageWidth - margin - 28, y + 6.2, { align: "center" });

    // Details Grid
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...textDark);

    doc.text(`Certificate No: ${c.certNumber}`, margin + 4, y + 13);
    doc.text(`Register / Portal: ${c.portal}`, margin + 85, y + 13);

    doc.text(`Date of Issue: ${c.issued}`, margin + 4, y + 19);
    doc.text(`Validity Expiry: ${c.validThrough}`, margin + 85, y + 19);

    doc.setFont("helvetica", "italic");
    doc.setTextColor(...textMuted);
    doc.text(`Register Audit Note: ${c.notes}`, margin + 4, y + 26);

    y += 35;
  });

  // Statutory Verification declaration
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...textMuted);
  doc.text(
    "* All certificates have been pre-verified through synthetic & live API interconnects in conformity with PPRA guidelines.",
    margin,
    pageHeight - 22
  );

  // ==========================================
  // PAGE 3: PRICED BILL OF QUANTITIES (BOQ)
  // ==========================================
  doc.addPage();
  drawHeader(3, 4, "PRICED BILL OF QUANTITIES");

  y = 25;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...primaryNavy);
  doc.text("SECTION 3: FINANCIAL QUOTATION & LINE ITEMS SCHEDULE", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...textMuted);
  doc.text(
    "Benchmarked against published PPRA Market Price Index baselines. All rates in Kenya Shillings (KES).",
    margin,
    y
  );
  y += 8;

  // Table Header
  const colX = {
    no: margin + 3,
    desc: margin + 14,
    qty: margin + 98,
    unit: margin + 112,
    rate: margin + 134,
    total: pageWidth - margin - 4,
  };

  doc.setFillColor(...primaryNavy);
  doc.rect(margin, y, contentWidth, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("#", colX.no, y + 5.5);
  doc.text("ITEM DESCRIPTION & TECHNICAL SPECIFICATION", colX.desc, y + 5.5);
  doc.text("QTY", colX.qty, y + 5.5);
  doc.text("UNIT", colX.unit, y + 5.5);
  doc.text("UNIT PRICE (KES)", colX.rate, y + 5.5);
  doc.text("TOTAL AMOUNT (KES)", colX.total, y + 5.5, { align: "right" });

  y += 8;

  const lineItems = [
    {
      num: "1",
      title: "Commercial Grade Desktop Computers",
      specs: "Intel Core i7 13th Gen, 32GB DDR5 RAM, 1TB NVMe SSD, WiFi 6E, Gigabit LAN, 24' FHD IPS, Genuine Win 11 Pro OEM",
      qty: "80",
      unit: "Units",
      unitPrice: "95,000",
      total: "7,600,000",
      benchmark: "PPRA Baseline: KES 98,500 (-3.5% Variance - Market Competitive)",
    },
    {
      num: "2",
      title: "27-inch 4K IPS Ultra-Slim Desktop Monitors",
      specs: "3840x2160 resolution, 99% sRGB, Height-adjustable stand, USB-C 65W Power Delivery, HDMI 2.1, DisplayPort 1.4",
      qty: "80",
      unit: "Units",
      unitPrice: "28,000",
      total: "2,240,000",
      benchmark: "PPRA Baseline: KES 30,000 (-6.7% Variance - Below Market Median)",
    },
    {
      num: "3",
      title: "24-Port Managed PoE+ Gigabit Network Switches",
      specs: "Layer 2/3 Enterprise Managed Switch, 24x 1GbE PoE+ ports (370W budget), 4x 10G SFP+ uplinks, CLI/Web/SNMPv3",
      qty: "20",
      unit: "Units",
      unitPrice: "75,000",
      total: "1,500,000",
      benchmark: "PPRA Baseline: KES 82,000 (-8.5% Variance - Volume Discounted)",
    },
    {
      num: "4",
      title: "Structured Cat6A Cabling & Patch Panels",
      specs: "LSZH 10Gbps rated Cat6A pure copper cabling, 24-port loaded patch panels, cable trays, testing, and Fluke certification",
      qty: "20",
      unit: "Lots",
      unitPrice: "45,000",
      total: "900,000",
      benchmark: "PPRA Baseline: KES 48,000 (-6.2% Variance - Standard Market Range)",
    },
  ];

  lineItems.forEach((item, index) => {
    const rowHeight = 22;
    doc.setFillColor(index % 2 === 0 ? 255 : 248, index % 2 === 0 ? 255 : 250, index % 2 === 0 ? 255 : 252);
    doc.rect(margin, y, contentWidth, rowHeight, "F");

    doc.setDrawColor(...borderGray);
    doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...primaryNavy);
    doc.text(item.num, colX.no, y + 6);
    doc.text(item.title, colX.desc, y + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...textDark);
    doc.text(item.qty, colX.qty, y + 6);
    doc.text(item.unit, colX.unit, y + 6);
    doc.text(item.unitPrice, colX.rate, y + 6);

    doc.setFont("helvetica", "bold");
    doc.text(item.total, colX.total, y + 6, { align: "right" });

    // Specs
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...textMuted);
    const splitSpecs = doc.splitTextToSize(item.specs, 80);
    doc.text(splitSpecs[0], colX.desc, y + 11);

    // Benchmark subtext
    doc.setFont("helvetica", "italic");
    doc.setFontSize(6.5);
    doc.setTextColor(...accentBlue);
    doc.text(item.benchmark, colX.desc, y + 17);

    y += rowHeight;
  });

  // Totals Box
  y += 4;
  doc.setFillColor(...bgLight);
  doc.roundedRect(pageWidth - margin - 90, y, 90, 28, 2, 2, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...textDark);
  doc.text("Subtotal (Excl. VAT):", pageWidth - margin - 86, y + 6);
  doc.text("KES 10,551,724.14", pageWidth - margin - 4, y + 6, { align: "right" });

  doc.text("VAT (16% Statutory):", pageWidth - margin - 86, y + 12);
  doc.text("KES 1,688,275.86", pageWidth - margin - 4, y + 12, { align: "right" });

  doc.setDrawColor(...borderGray);
  doc.line(pageWidth - margin - 86, y + 15, pageWidth - margin - 4, y + 15);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...primaryNavy);
  doc.text("TOTAL BID QUOTATION:", pageWidth - margin - 86, y + 21);
  doc.setTextColor(...accentBlue);
  doc.text("KES 12,240,000.00", pageWidth - margin - 4, y + 21, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...textMuted);
  doc.text("(Allocated Budget Ceiling: KES 12,500,000.00 — Within Range)", pageWidth - margin - 4, y + 26, {
    align: "right",
  });

  // Terms and Commercial Conditions
  y += 34;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primaryNavy);
  doc.text("COMMERCIAL & SERVICE LEVEL TERMS:", margin, y);
  y += 6;

  const terms = [
    "• Delivery Lead Time: Thirty (30) calendar days from receipt of official Local Purchase Order (LPO).",
    "• Hardware Warranty: Twelve (12) months comprehensive on-site replacement warranty backed by manufacturer authorization.",
    "• Country of Origin: Genuine original equipment manufacturer (OEM) units with international ISO/IEC certification.",
    "• Payment Terms: Thirty (30) days post delivery, inspection, testing, and acceptance by the inspection committee.",
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...textDark);
  terms.forEach((t) => {
    doc.text(t, margin, y);
    y += 5;
  });

  // ==========================================
  // PAGE 4: SWORN AFFIDAVITS & DECLARATIONS
  // ==========================================
  doc.addPage();
  drawHeader(4, 4, "LEGAL DECLARATIONS & OATHS");

  y = 25;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...primaryNavy);
  doc.text("SECTION 4: STATUTORY AFFIDAVITS & NON-COLLUSION DECLARATION", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...textMuted);
  doc.text("Mandatory sworn declarations under Sections 62 and 79 of the PPADA 2015.", margin, y);
  y += 8;

  const declarations = [
    {
      title: "A. Anti-Corruption & Non-Debarment Declaration (PPADA 2015 s.62)",
      text: "We solemnly declare that neither Apex Sovereign Technologies Ltd, nor any of its directors, key shareholders, or affiliated enterprises have been convicted of any fraudulent, collusive, or corrupt practices, nor are we debarred by the Public Procurement Regulatory Authority (PPRA) from participating in public procurement proceedings in Kenya or elsewhere.",
    },
    {
      title: "B. Declaration of Conflict of Interest & Independent Bid Determination (s.79(1))",
      text: "We declare under oath that this tender submission has been formulated independently without any agreement, arrangement, understanding, or communication with any competitor regarding pricing, methodology, bid rigging, or customer allocation. None of our directors or personnel have any familial, financial, or personal interest in Kenya Education Board Services.",
    },
    {
      title: "C. Data Sovereignty & Document Authenticity Warranty",
      text: "We certify that all documents, certificates, financial models, and technical specifications submitted within this dossier are authentic, genuine, and un-tampered representations of official registry records. We acknowledge that any false representation entails immediate disqualification and prosecution under Section 176 of PPADA 2015.",
    },
  ];

  declarations.forEach((d) => {
    doc.setFillColor(...bgLight);
    doc.setDrawColor(...borderGray);
    doc.roundedRect(margin, y, contentWidth, 26, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...primaryNavy);
    doc.text(d.title, margin + 4, y + 6);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(...textDark);
    const split = doc.splitTextToSize(d.text, contentWidth - 8);
    doc.text(split, margin + 4, y + 12);

    y += 31;
  });

  y += 4;

  // Sworn before Commissioner for Oaths
  doc.setFillColor(254, 252, 232); // amber soft
  doc.setDrawColor(253, 224, 71);
  doc.roundedRect(margin, y, contentWidth, 36, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(133, 77, 14);
  doc.text("COMMISSIONER FOR OATHS ATTESTATION & JURAT", margin + 6, y + 7);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(113, 63, 18);
  doc.text(
    "SWORN at Nairobi this 14th day of November 2026 by the said Dr. Grace W. Nyambura (Deponent),",
    margin + 6,
    y + 13
  );
  doc.text("who is personally known to me and produced Kenyan ID No: 24891032.", margin + 6, y + 17);

  doc.text("BEFORE ME:  Patrick M. Omwenga, Advocate & Commissioner for Oaths", margin + 6, y + 24);
  doc.text("Stamp & Signature: [OFFICIAL COMMISSIONER EMBOSSMENT SEAL AFFIXED]", margin + 6, y + 29);

  y += 44;

  // Summary Checklist for the video demo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primaryNavy);
  doc.text("TENDER DOSSIER ATTACHMENT INVENTORY:", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...textDark);
  doc.text("[x] Form of Tender & Transmittal Letter (Signed & Sealed)", margin, y);
  doc.text("[x] KRA Tax Compliance Certificate (KRA-TAX-2026-99182)", margin + 85, y);
  y += 4.5;
  doc.text("[x] BRS Certificate of Incorporation (PVT-2024-889911)", margin, y);
  doc.text("[x] NSSF Clearance Statement (NSSF-EMP-55210)", margin + 85, y);
  y += 4.5;
  doc.text("[x] Social Health Authority (SHA/SHIF) Certificate", margin, y);
  doc.text("[x] AGPO Certificate (Youth Special Category)", margin + 85, y);
  y += 4.5;
  doc.text("[x] Priced Schedule & Technical Specifications (KES 12.24M)", margin, y);
  doc.text("[x] Sworn Non-Collusion & Anti-Corruption Affidavit", margin + 85, y);

  return doc;
}

const doc = createBidPacket();
const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

const targetPaths = [
  path.resolve("public/sample-bid-packet.pdf"),
  path.resolve("public/Apex_Sovereign_Technologies_Bid_Packet_T-2026-KEBS-014.pdf"),
  path.resolve("dist/sample-bid-packet.pdf"),
  path.resolve("dist/Apex_Sovereign_Technologies_Bid_Packet_T-2026-KEBS-014.pdf"),
  path.resolve("SAMPLE_BID_PACKET.pdf"),
];

for (const p of targetPaths) {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, pdfBuffer);
    console.log(`Successfully generated bid packet PDF at: ${p} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.warn(`Notice writing to ${p}:`, err.message);
  }
}
