## [1.4.0] - 2026-07-25

### 🚀 Features
- **Rooms are now tied to an Albion server** (Europe / Americas / Asia), to build a reliable database of Map Features across servers.
  - This will power "we think there's these features here, please confirm" abilities, with the potential (with enough data) to pre-fill map features based on a number of confirmed reports.
  - New rooms pick one when they're created, existing rooms get a prompt to set theirs, and the server pill in the room title lets you change it afterwards.
- **New version prompt**: when a substantial release of the mapper goes out, a toast asks you to reload the page to get the new version.
- The "Link Zone portals" hint can now be dismissed for good — a "Don't show this again" link on the prompt itself, plus a sub-toggle under Hints in room settings to bring it back.
- **Rooms live much longer before cleanup**: 
  - Aborted rooms (rooms where people created the room but did nothing with it) 48 hours → 5 days
  - Abandoned rooms (where no-one has modified it) 5 days → 30 days.
- Added a donation prompt with a Ko-fi link, shown after a few separate visits. Dismissing it or tipping hides it permanently.

### 🐛 Bug Fixes
- Map icon emoji (pings, map history, chains) now scale with the map zoom on Linux and Android instead of getting stuck at the wrong size.
- Tabs whose connection silently died (typically after a server update) now notice and reconnect, instead of sitting there looking connected forever. Reconnects also heal immediately when you come back to the tab or regain network.
- Modals now render above the settings tray on mobile — the cog no longer pokes through Change password / Lock room.
- Locked rooms are now shown as a list of rooms.
- The "Which server is this room on?" prompt no longer flashes up on every room load — it now waits until the room's details have actually arrived, and only appears if the room really is unassigned.

## [1.3.0] - 2026-07-18

### 🚀 Features
- Added ability to lock rooms

### 🐛 Bug Fixes
- Map History is now properly retained and not deleted when a map or chain of maps are deleted.
- Fixed Portal rotations / (de)activations not being properly relayed back to the client who changed them.

## [1.2.1] - 2026-07-14
### 🐛 Bug Fixes
- Added new home page icon
- Setos-Aiaitum and Setitos-Obobrom are now not roads hideouts
- Speculative fix to map history being deleted

## [1.2.0] - 2026-06-18
### New Features
- Introducing **Map Chains**: create multiple separate map zone chains, each with its own starting zone, perfect for scouting from the outlands into roads or Brecilien.
- **Royal Continent / Outlands inter-connections** linking two non-roads zones (royal continent, outlands, etc.) now creates a permanent connection with no timer. The connection edge pill displays "Permanent" instead of a countdown, and the timer/slots UI is hidden. This enables you to map routes directly to a city.
- You are now able to rename rooms.
- Added changelog "slideshows" which you will see if you have already created a map, or via a button on the landing page.

### Reworked
- Route Plotting now require you to select a start and end zone. This does now enable the ability to plot routes in reverse of the normal "flow" of the map.
  - You still can only plot one route at a time.
  - The route must be within the same chain of zones.

### Fixes
- Zone rotation desync bug fixed for good!
- Multi-portal links between two zones is now properly supported, you will not longer get an error adding them.
- Zones no longer get wrongly marked "explored" just from a time/portal change.
- Fixed Cieos-Atatlum rendering as the wrong shape, it is weirdly an O shape not a C shape!
- Fixed misaligned connection lines on zone handles.
- Added Discord image to the Discord buttons.