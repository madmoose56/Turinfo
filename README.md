# Turinfo

Installerbar PWA for turer i Norge. Finn hoteller, bensinstasjoner, elbillading og aktiviteter langs en kjørerute eller nær GPS-posisjonen din.

## Funksjoner

- Rutesøk mellom norske byer og tettsteder. Avstand fra valgt kjørerute: Ved vei (300 m), 1 km, 2 km eller 3 km.
- Hoteller i startstedets sammenhengende tettstedsområde utelates. Andre kategorier tas med.
- Aktiviteter: Familie, Friluft og sport, Kultur, Mat og drikke. Flere kategorier kan kombineres.
- Nær meg viser maksimalt 10 treff totalt, nærmest først i luftlinje. Søket utvides automatisk fra 10 til 25 og 50 km ved behov.
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

GPS hentes bare etter knappetrykk og nettleserens tillatelse. Koordinatene sendes til Overpass og brukes i kartvisningen; GPS-søk lagres ikke lokalt. Rutesøk lagres i nettleserens localStorage. Offentlige karttjenester kan ha nedetid og begrense trafikk. Data er ufullstendige; ingen sanntidspriser, åpningstidsvurdering, ledige rom eller ladeledighet. Avstander til steder er luftlinje til punkt/arealsenter, ikke garanti om kjørbar adkomst.

OpenStreetMap: https://www.openstreetmap.org/copyright
SSB-kilden ligger i dist/places.json (sourceUrl, year). Tettstedsgrenser er forenklet og håndterer ikke innvendige hull separat.

Nettstedet har tidligere hett Veihotell og Info på veien. Interne lagringsnøkler og eksisterende nettadresse er beholdt for kontinuitet. Denne GitHub-utgaven inneholder nettstedet/PWA-en; den tidligere SwiftUI-prototypen er et separat prosjekt.
