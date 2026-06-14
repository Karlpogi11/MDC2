import { getDb } from "./db/connection";
import { sites, parts, profiles } from "./db/schema";
import { sql, eq } from "drizzle-orm";
import { randomUUID as uuid } from "node:crypto";
import bcrypt from "bcryptjs";

async function seed() {
  const db = await getDb();

  // ── Admin user ──
  const existingAdmin = await db.query.profiles.findFirst({
    where: eq(profiles.username, "admin"),
  });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("admin123", 12);
    await db.execute(sql`
      INSERT INTO profiles (id, username, full_name, email, role, password_hash, is_active)
      VALUES (${uuid()}, 'admin', 'Administrator', 'admin@mdc.local', 'dc_admin', ${passwordHash}, true)
    `);
    console.log("Created admin user (admin / admin123)");
  } else {
    console.log("Admin user already exists, skipping");
  }

  // ── Parts ──
  const partData: Array<{ partNumber: string; partName: string; category: string; partType: string }> = [
    { partNumber: "661-20198", partName: "Battery - iPhone 13", category: "Battery", partType: "product" },
    { partNumber: "661-20199", partName: "Battery - iPhone 13 Mini", category: "Battery", partType: "product" },
    { partNumber: "661-20200", partName: "Battery - iPhone 13 Pro", category: "Battery", partType: "product" },
    { partNumber: "661-20201", partName: "Battery - iPhone 13 Pro Max", category: "Battery", partType: "product" },
    { partNumber: "661-20202", partName: "Display Assembly - iPhone 13", category: "Display", partType: "product" },
    { partNumber: "661-20203", partName: "Display Assembly - iPhone 13 Mini", category: "Display", partType: "product" },
    { partNumber: "661-20204", partName: "Display Assembly - iPhone 13 Pro", category: "Display", partType: "product" },
    { partNumber: "661-20205", partName: "Display Assembly - iPhone 13 Pro Max", category: "Display", partType: "product" },
    { partNumber: "661-21000", partName: "Battery - iPhone 14", category: "Battery", partType: "product" },
    { partNumber: "661-21001", partName: "Battery - iPhone 14 Plus", category: "Battery", partType: "product" },
    { partNumber: "661-21002", partName: "Battery - iPhone 14 Pro", category: "Battery", partType: "product" },
    { partNumber: "661-21003", partName: "Battery - iPhone 14 Pro Max", category: "Battery", partType: "product" },
    { partNumber: "661-21004", partName: "Display Assembly - iPhone 14", category: "Display", partType: "product" },
    { partNumber: "661-21005", partName: "Display Assembly - iPhone 14 Plus", category: "Display", partType: "product" },
    { partNumber: "661-21006", partName: "Display Assembly - iPhone 14 Pro", category: "Display", partType: "product" },
    { partNumber: "661-21007", partName: "Display Assembly - iPhone 14 Pro Max", category: "Display", partType: "product" },
    { partNumber: "661-22000", partName: "Battery - iPhone 15", category: "Battery", partType: "product" },
    { partNumber: "661-22001", partName: "Battery - iPhone 15 Plus", category: "Battery", partType: "product" },
    { partNumber: "661-22002", partName: "Battery - iPhone 15 Pro", category: "Battery", partType: "product" },
    { partNumber: "661-22003", partName: "Battery - iPhone 15 Pro Max", category: "Battery", partType: "product" },
    { partNumber: "661-22004", partName: "Display Assembly - iPhone 15", category: "Display", partType: "product" },
    { partNumber: "661-22005", partName: "Display Assembly - iPhone 15 Plus", category: "Display", partType: "product" },
    { partNumber: "661-22006", partName: "Display Assembly - iPhone 15 Pro", category: "Display", partType: "product" },
    { partNumber: "661-22007", partName: "Display Assembly - iPhone 15 Pro Max", category: "Display", partType: "product" },
    { partNumber: "661-23000", partName: "Battery - iPhone 16", category: "Battery", partType: "product" },
    { partNumber: "661-23001", partName: "Battery - iPhone 16 Plus", category: "Battery", partType: "product" },
    { partNumber: "661-23002", partName: "Battery - iPhone 16 Pro", category: "Battery", partType: "product" },
    { partNumber: "661-23003", partName: "Battery - iPhone 16 Pro Max", category: "Battery", partType: "product" },
    { partNumber: "661-23004", partName: "Display Assembly - iPhone 16", category: "Display", partType: "product" },
    { partNumber: "661-23005", partName: "Display Assembly - iPhone 16 Plus", category: "Display", partType: "product" },
    { partNumber: "661-23006", partName: "Display Assembly - iPhone 16 Pro", category: "Display", partType: "product" },
    { partNumber: "661-23007", partName: "Display Assembly - iPhone 16 Pro Max", category: "Display", partType: "product" },
    { partNumber: "661-24000", partName: "Battery - iPhone 17", category: "Battery", partType: "product" },
    { partNumber: "661-24001", partName: "Battery - iPhone 17 Plus", category: "Battery", partType: "product" },
    { partNumber: "661-24002", partName: "Battery - iPhone 17 Pro", category: "Battery", partType: "product" },
    { partNumber: "661-24003", partName: "Battery - iPhone 17 Pro Max", category: "Battery", partType: "product" },
    { partNumber: "661-24004", partName: "Display Assembly - iPhone 17", category: "Display", partType: "product" },
    { partNumber: "661-24005", partName: "Display Assembly - iPhone 17 Plus", category: "Display", partType: "product" },
    { partNumber: "661-24006", partName: "Display Assembly - iPhone 17 Pro", category: "Display", partType: "product" },
    { partNumber: "661-24007", partName: "Display Assembly - iPhone 17 Pro Max", category: "Display", partType: "product" },
  ];

  for (const p of partData) {
    await db.execute(sql`
      INSERT IGNORE INTO parts (id, part_number, part_name, category, part_type, is_active)
      VALUES (${uuid()}, ${p.partNumber}, ${p.partName}, ${p.category}, ${p.partType}, true)
    `);
  }
  console.log(`Seeded ${partData.length} parts`);

  // ── Sites ──
  const siteData: Array<{
    siteCode: string; siteName: string; invoicePrefix: string; address: string;
    contactEmails: string; shipToCode: string | null;
  }> = [
    { siteCode: "DC-MNL", siteName: "Makati Distribution Center", invoicePrefix: "DCMSPI#", address: "Makati City", contactEmails: '[]', shipToCode: null },
    { siteCode: "APP VN", siteName: "VERTIS NORTH", invoicePrefix: "VNSSR#", address: "Mobile Care Services Philippines, Inc. By Power Mac Center Vertis North, Apple Authorized Service Provider 3/F Unit R1-L3-006 Ayala Malls Vertis North, Bagong Pag-Asa Quezon City, Philippines 1100", contactEmails: '["cedricmatthew.carreon@mobilecareph.com","kurtjyronn.llobrera@mobilecareph.com"]', shipToCode: "1506282" },
    { siteCode: "ASP MK", siteName: "SM MARIKINA", invoicePrefix: "MRKSSR#", address: "Marcos Highway, Barangay Calumpang, Marikina City, Metro Manila, Philippines", contactEmails: '["giandanzel.samar@mobilecareph.com"]', shipToCode: "1240088" },
    { siteCode: "ASP NES", siteName: "NORTH EAST SQUARE", invoicePrefix: "NESSRR#", address: "2/L Northeast Square, #47 Connecticut, St. Northeast Greenhills San Juan City, Metro Manila", contactEmails: '["janajane.teneza@mobilecareph.com"]', shipToCode: "1102538" },
    { siteCode: "ASP GL5", siteName: "GLORIETTA 5", invoicePrefix: "GL5SSR#", address: "Unit 329 3/F Glorietta St., 5 Ayala Center, Brgy. San Lorenzo Makati City, Metro Manila", contactEmails: '["danica.ramos@powermaccenter.com","louiseanne.bitong@powermaccenter.com"]', shipToCode: "1102537" },
    { siteCode: "ASP SMS", siteName: "S MAISON", invoicePrefix: "SMSSSR#", address: "2/L, Smaison At Conrad Manila, Seaside Blvd., Coral Way, Moa Complex, Brgy. 76 Pasay City, 1300", contactEmails: '["jessabel.gregorio@mobilecareph.com","florenceedward.delena@mobilecareph.com"]', shipToCode: "1103790" },
    { siteCode: "APP MOA", siteName: "MALL OF ASIA", invoicePrefix: "MOASSR#", address: "2/L North Parking Building Cyberzone Power Mac Center Sm Mall Of Asia Barangay 76 Pasay City", contactEmails: '["jennelyn.decastro@mobilecareph.com"]', shipToCode: "1597912" },
    { siteCode: "APP PPM", siteName: "POWER PLANT MALL", invoicePrefix: "PPMSSR#", address: "Power Mac Center R2 level Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila", contactEmails: '["eljonrenz.quarto@mobilecareph.com"]', shipToCode: "1603617" },
    { siteCode: "APP GB3", siteName: "GREENBELT 3", invoicePrefix: "GB3SSR#", address: "Space Nos. 214-215, 2/F, Greenbelt 3, Greenbelt Complex, Ayala Center Brgy. Lorenzo, Makati City 1228 MAKATI CITY - GREENBELT", contactEmails: '["joshua.malubay@mobilecareph.com"]', shipToCode: "1645879" },
    { siteCode: "ASP NPM", siteName: "NEW POINT", invoicePrefix: "NPMSSR#", address: "Unit 1, 2F, Newpoint Mall, Doña Teresa Ave., Nepo Center, Angeles City Pampanga, Philippines, 2009", contactEmails: '["maurice.mojica@mobilecareph.com"]', shipToCode: "1196666" },
    { siteCode: "ASP CEB", siteName: "ROBINSONS GALLERIA, CEBU", invoicePrefix: "CEBSSR#", address: "MOBILECARE SERVICES PHILS. INC. 0001102534 4033, 4/L ROBINSONS GALLERIA CEBU CEBU CITY 25 6000 PH", contactEmails: '["johnaliza.amora@mobilecareph.com"]', shipToCode: "1102534" },
    { siteCode: "ASP ABREEZA", siteName: "ABREEZA MALL, DAVAO", invoicePrefix: "ABRSSR#", address: "2nd floor, Abreeza Mall JP Laurel Avenue, Bajada Davao City Davao del Sur 8000", contactEmails: '["jerry.dimakuta@mobilecareph.com","randy.rota@mobilecareph.com"]', shipToCode: "1102535" },
    { siteCode: "ASP CDO", siteName: "LIMKETKAI MALL, CDO", invoicePrefix: "CDOSRR#", address: "2/L,EAST CONCOURSE LIMKETKAI MALL, CAGAYAN DE ORO CITY 48 9000, PH", contactEmails: '["juliagamo.inguito@mobilecareph.com"]', shipToCode: "1218985" },
    { siteCode: "ASP ILOILO", siteName: "FESTIVE WALK MALL, ILOILO", invoicePrefix: "ILOSSR#", address: "G/F Festive Walk Mall, Iloilo Business Park, Airport Road, Mandurriao Iloilo City", contactEmails: '["ileto.palenciaii@powermaccenter.com","ileto.palenciaii@mobilecareph.com"]', shipToCode: null },
    { siteCode: "ASP NAG", siteName: "ROBINSONS NAGA", invoicePrefix: "NGSSR#", address: "Unit 101-101a, Level 1 Robinsons Naga, Brgy. Roxas Avenue, Cor Almeda Hwy, Naga City, Camarines Sur", contactEmails: '["johnlloyd.agapito@mobilecareph.com"]', shipToCode: "1730389" },
    { siteCode: "APP MEG", siteName: "SM MEGAMALL", invoicePrefix: "MGSSR#", address: "Bldg. B, Cyberzone, SM Megamall, Mandaluyong City 1550 Philippines", contactEmails: '["eugene.deborja@mobilecareph.com"]', shipToCode: "1745440" },
    { siteCode: "APP ANX", siteName: "SM ANNEX", invoicePrefix: "ANSSR#", address: "SMCITY NORTH EDSA, BRGY. STO CRISTO, QUEZON CITY 46 1105, PH", contactEmails: '["patrickjohn.rino@mobilecareph.com"]', shipToCode: "1764718" },
    { siteCode: "APP RM", siteName: "ROBINSONS MAGNOLIA", invoicePrefix: "RMSSR#", address: "Unit 211, Level 2, Robinsons Magnolia (Expansion Bldg), Aurora Blvd. Doña Hemady, Kaunlaran,Quezon City, Metro Manila, 1111", contactEmails: '["jeffrey.ignacio@mobilecareph.com"]', shipToCode: "1764735" },
    { siteCode: "APP TRI", siteName: "TRINOMA", invoicePrefix: "TRSSR#", address: "3rd Level, Mindanao Ave., TriNoma Mall, EDSA, cor North Ave, Quezon City, Metro Manila", contactEmails: '["jimboy.tondag@mobilecareph.com"]', shipToCode: "1764730" },
    { siteCode: "ASP LIM", siteName: "THE OUTLETS, LIMA Estate", invoicePrefix: "LMSSR#", address: "Blk A Unit R07-08, The Outlets at Lima Estates Lipa City, Batangas", contactEmails: '["jhimadrian.callos@mobilecareph.com"]', shipToCode: "1754212" },
    { siteCode: "ASP LAU", siteName: "ROBINSONS LA UNION", invoicePrefix: "LUSSR#", address: "Space 316, Level 3, Digiworld, Robinsons Place La Union, National Highway, Sevilla, San Fernando, La Union", contactEmails: '["mheynardjohanne.madarang@mobilecareph.com"]', shipToCode: "1815649" },
    { siteCode: "ASP COTABATO", siteName: "KCC MALL, COTABATO", invoicePrefix: "CBOSSR#", address: "Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave., Rosary Heights 2, Cotabato City, Cotabato", contactEmails: '["michellekaye.vingno@mobilecareph.com"]', shipToCode: null },
    { siteCode: "ASP FES", siteName: "FESTIVAL MALL, ALABANG", invoicePrefix: "FESSSR#", address: "Mobilecare Services Phils. Inc.-Fes 0001815657 Space No.Ugf-2274.2.1-Ugf-2274.2.2, Muntinlupa City 46 1781 Ph", contactEmails: '["josefvictor.cruz@mobilecareph.com","darwin.salvacion@mobilecareph.com"]', shipToCode: "1815657" },
    { siteCode: "APP BHS", siteName: "BONIFACIO HIGH STREET", invoicePrefix: "BHSSSR#", address: "1F, Wumaco Building, 7th Ave cor. Lane P, High Street, Taguig, 1635", contactEmails: '["ghibertjustine.flores@mobilecareph.com"]', shipToCode: "1836095" },
    { siteCode: "ASP ZAM", siteName: "KCC MALL DE ZAMBOANGA", invoicePrefix: "ZAMSSR#", address: "Mobilecare services inc. 2/f east wing, KCC mall de zamboanga, Governor Camins Avenue, Camino Nuevo, 7000.", contactEmails: '["ruther.calumpang@mobilecareph.com"]', shipToCode: "1128342" },
    { siteCode: "ASP POD", siteName: "THE PODIUM", invoicePrefix: "PODSSR#", address: "4/F, The Podium, 12 ADB Ave, Ortigas Center, Mandaluyong City, 1550 Metro Manila", contactEmails: '["jasmilrose.guban@mobilecareph.com","karldavid.garcia@mobilecareph.com"]', shipToCode: "1272226" },
  ];

  for (const s of siteData) {
    const isDc = s.siteCode === "DC-MNL";
    await db.execute(sql`
      INSERT INTO sites (id, site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
      VALUES (${uuid()}, ${s.siteCode}, ${s.siteName}, ${isDc}, true, ${s.invoicePrefix}, ${s.address}, ${s.contactEmails}, ${s.shipToCode})
      ON DUPLICATE KEY UPDATE site_name = VALUES(site_name), invoice_prefix = VALUES(invoice_prefix), address = VALUES(address), contact_emails = VALUES(contact_emails), ship_to_code = VALUES(ship_to_code)
    `);
  }
  console.log(`Seeded ${siteData.length} sites`);

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
