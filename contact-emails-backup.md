# Contact Emails Backup

All contact_emails were cleared from the database via migration `backend/src/db/migrations/0002_clear_contact_emails.sql` on 2026-06-16. Only **ASP POD (The Podium)** was kept.

To restore all, run:

```bash
cd backend && npx tsx src/seed.ts
```

Or restore per site in Config → Sites → edit.

## Original contacts

| Site Code | Name | Contact Emails |
|-----------|------|----------------|
| DC-MNL | Makati Distribution Center | *(none)* |
| APP VN | VERTIS NORTH | cedricmatthew.carreon@mobilecareph.com, kurtjyronn.llobrera@mobilecareph.com |
| ASP MK | SM MARIKINA | giandanzel.samar@mobilecareph.com |
| ASP NES | NORTH EAST SQUARE | janajane.teneza@mobilecareph.com |
| ASP GL5 | GLORIETTA 5 | danica.ramos@powermaccenter.com, louiseanne.bitong@powermaccenter.com |
| ASP SMS | S MAISON | jessabel.gregorio@mobilecareph.com, florenceedward.delena@mobilecareph.com |
| APP MOA | MALL OF ASIA | jennelyn.decastro@mobilecareph.com |
| APP PPM | POWER PLANT MALL | eljonrenz.quarto@mobilecareph.com |
| APP GB3 | GREENBELT 3 | joshua.malubay@mobilecareph.com |
| ASP NPM | NEW POINT | maurice.mojica@mobilecareph.com |
| ASP CEB | ROBINSONS GALLERIA, CEBU | johnaliza.amora@mobilecareph.com |
| ASP ABREEZA | ABREEZA MALL, DAVAO | jerry.dimakuta@mobilecareph.com, randy.rota@mobilecareph.com |
| ASP CDO | LIMKETKAI MALL, CDO | juliagamo.inguito@mobilecareph.com |
| ASP ILOILO | FESTIVE WALK MALL, ILOILO | ileto.palenciaii@powermaccenter.com, ileto.palenciaii@mobilecareph.com |
| ASP NAG | ROBINSONS NAGA | johnlloyd.agapito@mobilecareph.com |
| APP MEG | SM MEGAMALL | eugene.deborja@mobilecareph.com |
| APP ANX | SM ANNEX | patrickjohn.rino@mobilecareph.com |
| APP RM | ROBINSONS MAGNOLIA | jeffrey.ignacio@mobilecareph.com |
| APP TRI | TRINOMA | jimboy.tondag@mobilecareph.com |
| ASP LIM | THE OUTLETS, LIMA Estate | jhimadrian.callos@mobilecareph.com |
| ASP LAU | ROBINSONS LA UNION | mheynardjohanne.madarang@mobilecareph.com |
| ASP COTABATO | KCC MALL, COTABATO | michellekaye.vingno@mobilecareph.com |
| ASP FES | FESTIVAL MALL, ALABANG | josefvictor.cruz@mobilecareph.com, darwin.salvacion@mobilecareph.com |
| APP BHS | BONIFACIO HIGH STREET | ghibertjustine.flores@mobilecareph.com |
| ASP ZAM | KCC MALL DE ZAMBOANGA | ruther.calumpang@mobilecareph.com |
| ASP POD | THE PODIUM | jasmilrose.guban@mobilecareph.com, karldavid.garcia@mobilecareph.com |
