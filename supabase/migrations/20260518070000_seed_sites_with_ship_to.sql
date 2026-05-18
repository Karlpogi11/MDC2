-- Seed all MDC sites with ship_to_code from directories CSV
-- Upserts on site_code — safe to re-run

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP VN', 'VERTIS NORTH', false, true, 'VNSSR#', 'Mobile Care Services Philippines, Inc. By Power Mac Center Vertis North, Apple Authorized Service Provider 3/F Unit R1-L3-006 Ayala Malls Vertis North, , Bagong Pag-Asa Quezon City, Philippines 1100', ARRAY['cedricmatthew.carreon@mobilecareph.com','kurtjyronn.llobrera@mobilecareph.com'], '1506282')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP MK', 'SM MARIKINA', false, true, 'MRKSSR#', 'Marcos Highway, Barangay Calumpang, Marikina City, Metro Manila, Philippines', ARRAY['giandanzel.samar@mobilecareph.com'], '1240088')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP NES', 'NORTH EAST SQUARE', false, true, 'NESSRR#', '2/L Northeast Square, #47 Connecticut, St. Northeast Greenhills San Juan City, Metro Manila', ARRAY['janajane.teneza@mobilecareph.com'], '1102538')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP GL5', 'GLORIETTA 5', false, true, 'GL5SSR#', 'Unit 329 3/F Glorietta St., 5 Ayala Center, Brgy. San Lorenzo Makati City, Metro Manila', ARRAY['danica.ramos@powermaccenter.com','louiseanne.bitong@powermaccenter.com'], '1102537')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP SMS', 'S MAISON', false, true, 'SMSSSR#', '2/L, Smaison At Conrad Manila, Seaside Blvd., Coral Way, Moa Complex, Brgy. 76 Pasay City, 1300', ARRAY['jessabel.gregorio@mobilecareph.com','florenceedward.delena@mobilecareph.com'], '1103790')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP MOA', 'MALL OF ASIA', false, true, 'MOASSR#', '2/L North Parking Building Cyberzone Power Mac Center Sm Mall Of Asia Barangay 76 Pasay City', ARRAY['jennelyn.decastro@mobilecareph.com'], '1597912')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP PPM', 'POWER PLANT MALL', false, true, 'PPMSSR#', 'Power Mac Center R2 level Power Plant Mall, Brgy. Poblacion, Makati City, Metro Manila', ARRAY['eljonrenz.quarto@mobilecareph.com'], '1603617')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP GB3', 'GREENBELT 3', false, true, 'GB3SSR#', 'Space Nos. 214-215, 2/F, Greenbelt 3, Greenbelt Complex, Ayala Center Brgy. Lorenzo, Makati City 1228 MAKATI CITY - GREENBELT', ARRAY['joshua.malubay@mobilecareph.com'], '1645879')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP NPM', 'NEW POINT', false, true, 'NPMSSR#', 'Unit 1, 2F, Newpoint Mall, Doña Teresa Ave., Nepo Center, Angeles City Pampanga, Philippines, 2009', ARRAY['maurice.mojica@mobilecareph.com'], '1196666')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP CEB', 'ROBINSONS GALLERIA, CEBU', false, true, 'CEBSSR#', 'MOBILECARE SERVICES PHILS. INC.  0001102534  4033, 4/L ROBINSONS GALLERIA CEBU CEBU CITY 25 6000 PH', ARRAY['johnaliza.amora@mobilecareph.com'], '1102534')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP ABREEZA', 'ABREEZA MALL, DAVAO', false, true, 'ABRSSR#', '2nd floor, Abreeza Mall JP Laurel Avenue, Bajada Davao City Davao del Sur 8000', ARRAY['jerry.dimakuta@mobilecareph.com','randy.rota@mobilecareph.com'], '1102535')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP CDO', 'LIMKETKAI MALL, CDO', false, true, 'CDOSRR#', '2/L,EAST CONCOURSE LIMKETKAI MALL, CAGAYAN DE ORO CITY 48 9000, PH', ARRAY['juliagamo.inguito@mobilecareph.com'], '1218985')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP ILOILO', 'FESTIVE WALK MALL, ILOILO', false, true, 'ILOSSR#', 'G/F Festive Walk Mall, Iloilo Business Park, Airport Road, Mandurriao Iloilo City', ARRAY['ileto.palenciaii@powermaccenter.com','ileto.palenciaii@mobilecareph.com'], NULL)
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP NAG', 'ROBINSONS NAGA', false, true, 'NGSSR#', 'Unit 101-101a, Level 1 Robinsons Naga, Brgy. Roxas Avenue, Cor Almeda Hwy, Naga City, Camarines Sur', ARRAY['johnlloyd.agapito@mobilecareph.com'], '1730389')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP MEG', 'SM MEGAMALL', false, true, 'MGSSR#', 'Bldg. B, Cyberzone, SM Megamall, Mandaluyong City 1550 Philippines', ARRAY['eugene.deborja@mobilecareph.com'], '1745440')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP ANX', 'SM ANNEX', false, true, 'ANSSR#', 'SMCITY NORTH EDSA, BRGY. STO CRISTO, QUEZON CITY 46 1105, PH', ARRAY['patrickjohn.rino@mobilecareph.com'], '1764718')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP RM', 'ROBINSONS MAGNOLIA', false, true, 'RMSSR#', 'Unit 211, Level 2, Robinsons Magnolia (Expansion Bldg), Aurora Blvd. Doña Hemady, Kaunlaran,Quezon City, Metro Manila, 1111', ARRAY['jeffrey.ignacio@mobilecareph.com'], '1764735')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP TRI', 'TRINOMA', false, true, 'TRSSR#', '3rd Level, Mindanao Ave., TriNoma Mall, EDSA, cor North Ave, Quezon City, Metro Manila', ARRAY['jimboy.tondag@mobilecareph.com'], '1764730')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP LIM', 'THE OUTLETS, LIMA Estate', false, true, 'LMSSR#', 'Blk A Unit R07-08, The Outlets at Lima Estates Lipa City, Batangas', ARRAY['jhimadrian.callos@mobilecareph.com'], '1754212')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP LAU', 'ROBINSONS LA UNION', false, true, 'LUSSR#', 'Space 316, Level 3, Digiworld, Robinsons Place La Union, National Highway, Sevilla, San Fernando, La Union', ARRAY['mheynardjohanne.madarang@mobilecareph.com'], '1815649')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP COTABATO', 'KCC MALL, COTABATO', false, true, 'CBOSSR#', 'Space No. IL-226 2nd Floor, KCC Mall of Cotabato, 10 Quezon Ave., Rosary Heights 2, Cotabato City, Cotabato', ARRAY['michellekaye.vingno@mobilecareph.com'], NULL)
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP FES', 'FESTIVAL MALL, ALABANG', false, true, 'FESSSR#', 'Mobilecare Services Phils. Inc.-Fes 0001815657 Space No.Ugf-2274.2.1-Ugf-2274.2.2, Muntinlupa City 46 1781 Ph', ARRAY['josefvictor.cruz@mobilecareph.com','darwin.salvacion@mobilecareph.com'], '1815657')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('APP BHS', 'BONIFACIO HIGH STREET', false, true, 'BHSSSR#', '1F, Wumaco Building, 7th Ave cor. Lane P, High Street, Taguig, 1635', ARRAY['ghibertjustine.flores@mobilecareph.com'], '1836095')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP ZAM', 'KCC MALL DE ZAMBOANGA', false, true, 'ZAMSSR#', 'Mobilecare services inc. 2/f east wing, KCC mall de zamboanga, Governor Camins Avenue, Camino Nuevo, 7000.', ARRAY['ruther.calumpang@mobilecareph.com'], '1128342')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

INSERT INTO public.sites (site_code, site_name, is_dc, is_active, invoice_prefix, address, contact_emails, ship_to_code)
VALUES ('ASP POD', 'THE PODIUM', false, true, 'PODSSR#', '4/F, The Podium, 12 ADB Ave, Ortigas Center, Mandaluyong City, 1550 Metro Manila', ARRAY['jasmilrose.guban@mobilecareph.com','karldavid.garcia@mobilecareph.com'], '1272226')
ON CONFLICT (site_code) DO UPDATE SET
  site_name      = EXCLUDED.site_name,
  invoice_prefix = EXCLUDED.invoice_prefix,
  address        = EXCLUDED.address,
  contact_emails = EXCLUDED.contact_emails,
  ship_to_code   = EXCLUDED.ship_to_code;

