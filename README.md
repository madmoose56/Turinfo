# Turinfo

Installerbar PWA for turer i Norge. Finn hoteller, bensinstasjoner, elbillading og aktiviteter langs en kjørerute eller nær GPS-posisjonen din.

## Funksjoner

- Rutesøk fra et valgt norsk sted eller «Der jeg er» (GPS) til en norsk by eller et tettsted. Avstand fra valgt kjørerute: Ved vei (300 m), 1 km, 2 km eller 3 km.
- Alle kategorier innen 3 km fra valgt startpunkt utelates. Hele målstedets registrerte SSB-tettstedsområde tas med uansett avstanden fra ruta. For Kartverket-steder uten en registrert tettstedsgrense brukes rutekorridoren.
- Bensin- og ladetreff kan også filtreres med «Alle» og kjedene/operatørene som faktisk finnes i listen. Bensin bruker registrert merke først; elbillading bruker registrert operatør først. Knapper viser antall, finnes under søket og i den faste navigasjonen, og filtrerer listen uten nye forespørsler.
- Hotelltreff kan filtreres med knapper for «Alle» og kjedene som faktisk finnes i resultatene, for eksempel Best Western og Thon. Registrert merke/kjede brukes først, med kjente kjedenavn i hotellnavnet som reserve. Hoteller uten kjent kjede ligger under «Øvrige hoteller». Filtrering gjelder listen, krever ikke et nytt søk og finnes både på rutesiden og Nær meg.
- Aktiviteter: Familie, Friluft og sport og Kultur. Mat og drikke er et eget tema med filtre for kjeder og spisestedsnavn. Én kategori vises om gangen.
- «Velg rute» er valgt som standard og viser/skjuler rutens søkefelt uten å miste stedvalgene. Fra og Til husker siste redigering og valgt stedsidentitet, også etter mislykkede søk. «Nær meg» ligger til høyre for «Velg rute» og åpner et eget GPS-søk med de samme kategorivalgene, treffiltrene og kartet. Avstanden måles i sirkel fra GPS-posisjonen. Nær meg søker innen 3 km og viser maksimalt 10 treff fra valgt kategori, nærmest først i luftlinje. GPS er sentrert i kartutsnittet på 20 × 20 km; sirkelen viser søkeradius.
- Når en kategori trykkes, hentes den først. Deretter hentes alle øvrige kategorier automatisk i bakgrunnen, innen 3 km fra ruta eller GPS-punktet. Bakgrunnstreff lagres bare i minnet. Et kategoribytte avbryter uferdige bakgrunnsforespørsler og gir valgt kategori prioritet; ferdig lastede kategorier vises direkte. Startvalg og avstandsfiltre starter ikke søk.
- Etter tre sekunder vises en fast «Avbryt søk»/«Avbryt bakgrunnssøk»-knapp. Avbrytelse stopper nettforespørsler, frigjør skjemaet og beholder eksisterende treff. Sene nett- og GPS-svar ignoreres. Nytt søk kan startes umiddelbart.
- Naviger hit åpner Apple Maps på iPhone/iPad eller Google Maps på andre enheter. Kartappen bruker aktuell posisjon. Start/Kjør må trykkes ved behov i kartappen.
- PWA med frakoblet appskall og siste lagrede rutesøk. Nye søk og bakgrunnskart krever nett.

## Kjør lokalt

Krever Node.js for den inkluderte lokale serveren og kontrollene. Ingen npm-pakker må installeres.

```sh
npm start
npm test
```

Åpne http://127.0.0.1:4173/. Kildekode og publiserbare filer ligger i dist/. Valgfri hosting krever en statisk HTTPS-tjeneste som serverer dist/. PWA-installasjon krever HTTPS eller localhost.

## Data og personvern

Byer og tettsteder: Photon og SSB 2026. Kjørerute: OSRM. Steder: OpenStreetMap via Overpass. Kart: Leaflet/OpenStreetMap.

GPS hentes bare etter knappetrykk og nettleserens tillatelse. GPS-koordinatene sendes til OSRM for GPS-ruter og til Overpass for stedssøk, og brukes i kartvisningen. Ruter og søk fra GPS lagres ikke lokalt. Rutesøk fra navngitte steder lagres i nettleserens localStorage. Offentlige karttjenester kan ha nedetid og begrense trafikk. Data er ufullstendige; ingen sanntidspriser, åpningstidsvurdering, ledige rom eller ladeledighet. Avstander til steder er luftlinje til punkt/arealsenter, ikke garanti om kjørbar adkomst.

OpenStreetMap: https://www.openstreetmap.org/copyright
SSB-kilden ligger i dist/places.json (sourceUrl, year). Tettstedsgrenser er forenklet og håndterer ikke innvendige hull separat.

Nettstedet har tidligere hett Veihotell og Info på veien. Interne lagringsnøkler og eksisterende nettadresse er beholdt for kontinuitet. Denne GitHub-utgaven inneholder nettstedet/PWA-en; den tidligere SwiftUI-prototypen er et separat prosjekt.

Begge rutefeltene viser stedsforslag fra første bokstav. Alle 1 000 SSB-tettsteder i 2026-listen er med, med kommune for å skille like navn. Gjeldende navn og kommuner hentes fra [SSBs tettsted–kommune-korrespondanse](https://data.ssb.no/api/klass/v1/correspondencetables/2945?language=nb); Malvik er også søkealias for Vikhammer. Valgt tettsteds-ID følger søket. Ved manglende geokoding brukes et punkt innen tettstedsgrensen som ruteutgangspunkt.

Stedsforslagene inkluderer direkte oppslag i [Kartverkets stedsnavn-API](https://kartverket.no/api-og-data/stedsnavndata/brukarrettleiing-stadnamn-api). Fra første bokstav kombineres lokale SSB-tettsteder med små, avgrensede oppslag. Byer og tettsteder prioriteres, og kommune og stedstype vises. Hele stedsnavnregisteret lastes ikke ned; svarene mellomlagres ikke i localStorage eller service worker. Valgte Kartverket-treff bruker registerets kartposisjon i rutesøket. Bare siste valgte Fra/Til-sted lagres som skjemavalg; GPS-posisjonen lagres ikke.

Kategoriene er enkeltvalg. Trykk på Hoteller, Bensin, Elbil-lading eller en aktivitet for å starte søket direkte; trykk igjen for å gjenta søket. Gjelder rute og Nær meg.
