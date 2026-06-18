# Changelog

## UNRELEASED [1.2.0] - 2026-06-18
### New Features
- Introducing **Map Chains**: create multiple separate map zone chains, each with its own starting zone, perfect for scouting from the outlands into roads or Brecilien.
- **Royal Continent / Outlands inter-connections** linking two non-roads zones (royal continent, outlands, etc.) now creates a permanent connection with no timer. The connection edge pill displays "Permanent" instead of a countdown, and the timer/slots UI is hidden. This enables you to map routes directly to a city.
- You are now able to rename rooms.
- Added changelog "slideshows" which you will see if you have already created a map.

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