<?php
/**
 * Seed data for the Trinity Court Projects tracker.
 *
 * These are the 25 building improvement items compiled by the RTM board
 * (from the "Building Improvements & Works List"). They are inserted on
 * activation so the tracker is usable immediately, and can be re-imported
 * from Projects > Import seed list.
 *
 * Costs are intentionally left empty: no quotes were in at the time of
 * compiling. Enter figures on each project as quotes arrive.
 *
 * @package Trinity_Court_Projects
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Programme groups seeded alongside the items. Slug => [name, type].
 * type is one of: mega, sprint, programme.
 */
function tcp_seed_groups() {
	return array(
		'waste-bin-store'   => array( 'Waste & Bin Store Overhaul', 'epic' ),
		'communal-refresh'  => array( 'Communal Areas Refresh', 'initiative' ),
		'fire-safety-sprint'=> array( 'Fire Safety', 'sprint' ),
	);
}

/**
 * The seed projects.
 *
 * Each entry:
 *   ref, title, category, priority, status, location, problem, solution,
 *   groups (array of group slugs).
 */
function tcp_seed_projects() {
	return array(
		array(
			'ref'      => '1',
			'title'    => 'Bin Store & Flytipping',
			'category' => 'Waste & Recycling',
			'priority' => 'high',
			'status'   => 'not-started',
			'location' => 'Bin store, courtyard/rear',
			'problem'  => 'The bin store regularly overflows and gets wedged shut by the volume of rubbish inside, stopping residents opening it and stopping council crews accessing it to empty bins. Furniture, mattresses and bagged rubbish are dumped outside it and around the courtyard on a near-weekly basis. Thanet District Council has also missed multiple consecutive collections, worsening the backlog.',
			'solution' => 'Reconfigure and enlarge the bin store with a physically separated section for general waste and one for recycling, so bins cannot be jammed against each other. Add a rope or barrier divider inside to stop bins shifting. Fit a cover/awning over the external waste area to reduce weather damage, smell and flies. Clear signage on the store and the gate.',
			'groups'   => array( 'waste-bin-store' ),
		),
		array(
			'ref'      => '2',
			'title'    => 'Security / CCTV',
			'category' => 'Security',
			'priority' => 'urgent',
			'status'   => 'arranging-quote',
			'location' => 'All corridors, bin store, fire exit, post room, main entrance, courtyard, gate',
			'problem'  => 'CCTV has not worked for 4+ years. The control hub was damaged/removed years ago and never replaced, yet Centrick charged residents around £250/year for a service that did not exist. Repeated parcel theft from the lobby and post room (including a confirmed police case), entrance glass smashed on separate occasions, and ongoing flytipping in the bin store and near the fire exit have all gone uninvestigated with no footage available. Coverage limited to entrances and stairwells only would not be enough; it would not show which flat an item such as a dumped bed actually came from.',
			'solution' => 'Full CCTV installation covering every corridor (not just entrances and stairwells), the bin store, the fire exit, the post room, the main entrance, courtyard and gate. Corridor-level coverage is what lets us trace which flat items were carried from before being dumped, so removal costs can be charged back or fines issued. Bin store and fire exit cameras capture the point rubbish is actually dumped. Post room coverage addresses parcel theft directly.',
			'groups'   => array(),
		),
		array(
			'ref'      => '3',
			'title'    => 'Front Entrance Door',
			'category' => 'Entrance & Doors',
			'priority' => 'high',
			'status'   => 'quoted',
			'location' => 'Main entrance',
			'problem'  => 'The front door has been damaged for an extended period: entrance glass smashed on multiple separate occasions, patched with cardboard and then perspex as an interim fix, and the door no longer locks/seals properly (magnets not engaging).',
			'solution' => 'Already scoped separately as a new double-leaf GRP entrance door designed to match the building, with a concept design already supplied to XL (see door specification). Logged here for resident visibility and to confirm urgency, given the repeated interim patch repairs.',
			'groups'   => array(),
		),
		array(
			'ref'      => '4',
			'title'    => 'Gutters, Downpipes & Roof Drainage',
			'category' => 'Drainage & Roof',
			'priority' => 'high',
			'status'   => 'not-started',
			'location' => 'All external downpipes and hoppers',
			'problem'  => 'Downpipes and hoppers repeatedly block with debris and bird nests, causing water to back up, overflow and enter flats, and creating loud noise on windows during rain. This is separate from the main roof repair and has caused repeat leaks even where main roof works have been done.',
			'solution' => 'Clear all downpipes and hoppers and fit hopper covers/guards to stop nesting and debris collecting. Add to an annual gutter maintenance schedule rather than reactive call-outs.',
			'groups'   => array(),
		),
		array(
			'ref'      => '5',
			'title'    => 'Cleaning Contract',
			'category' => 'Cleaning',
			'priority' => 'medium',
			'status'   => 'not-started',
			'location' => 'All communal areas',
			'problem'  => 'Cleaning frequency and scope have been inconsistent (weekly, then monthly, then fortnightly) and residents are unclear what is included. Communal areas including lift tracks, courtyard and carpets look neglected between visits. Carpet stains from dumped rubbish and general wear have not been resolved by shampooing. Windows are not cleaned on a regular cycle, and junk mail and post build up uncleared in the post room and its electrical cupboards.',
			'solution' => 'Confirm cleaning specification and frequency with XL in writing (e.g. weekly light clean, monthly deep clean), explicitly including courtyard and lift. Add regular window cleaning, weekly removal of junk mail from the post room, and regular cleaning of the post room electrical cupboards to the specification. Treat carpet cleaning as a stopgap only; see the communal flooring programme for the long-term fix.',
			'groups'   => array(),
		),
		array(
			'ref'      => '6',
			'title'    => 'Waste & Recycling Provision',
			'category' => 'Waste & Recycling',
			'priority' => 'medium',
			'status'   => 'not-started',
			'location' => 'Bin store',
			'problem'  => 'No dedicated recycling bin is currently provided by the council. Food waste bins exist but are underused. This pushes residents towards street bins or skipping recycling altogether, and adds to the flytipping problem when residents do not want to store waste until collection.',
			'solution' => 'Request a dedicated recycling bin allocation from Thanet District Council, paired with clear signage and a directors/XL door-to-door awareness push for residents not on the resident WhatsApp group.',
			'groups'   => array( 'waste-bin-store' ),
		),
		array(
			'ref'      => '7',
			'title'    => 'Exterior Stonework & Pressure Washing',
			'category' => 'Exterior & Grounds',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'Exterior stonework, entrance, downpipes, side road',
			'problem'  => 'Stonework, downpipes and the side road get dirty over time (general grime, stickers, graffiti, and residue from waste collections), making the building and its surroundings look neglected.',
			'solution' => 'Pressure wash exterior stonework and the entrance area as required rather than on a fixed schedule. Remove stickers and graffiti from downpipes and other exterior surfaces during the same visit. Extend to an ad hoc pressure wash and clean of the side road when it gets particularly dirty from waste collections.',
			'groups'   => array(),
		),
		array(
			'ref'      => '8',
			'title'    => 'Gardening & External Planting',
			'category' => 'Exterior & Grounds',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'Front of building, exterior perimeter',
			'problem'  => 'Pots at the front of the building are mismatched, old or unattractive, with no coordinated planting scheme, and the areas around the building have weeds.',
			'solution' => 'Clear out old/ugly pots and replace with a uniform set. Instruct a gardener to plant evergreen and seasonal planting for year-round presentability, weed the building exterior and immediate surrounding areas, and add hanging baskets along the front of the building for summer.',
			'groups'   => array(),
		),
		array(
			'ref'      => '9',
			'title'    => 'Window Frame Painting',
			'category' => 'Exterior & Grounds',
			'priority' => 'medium',
			'status'   => 'not-started',
			'location' => 'All external window frames',
			'problem'  => 'Window frame paint is flaking. Frames have not been painted in around 20 years and will keep deteriorating without attention.',
			'solution' => 'Repaint window frames, then set a recurring cycle (roughly every 5 to 10 years) to stay on top of it going forward rather than letting it lapse again.',
			'groups'   => array(),
		),
		array(
			'ref'      => '10',
			'title'    => 'Signage Rationalisation & Estate Agent Boards',
			'category' => 'Signage',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'Building exterior',
			'problem'  => 'The building carries unnecessary signage (e.g. a visible CCTV sign that adds nothing) that looks untidy. Separately, estate agent boards are regularly attached to the building for sale/let flats, which the lease does not permit and which looks poor with 38 flats often having one up at a time.',
			'solution' => 'Audit and remove all signage that is not legally or functionally required, keeping only what is necessary. Enforce the lease restriction on external boards/signage (Fifth Schedule) and formally notify agents and leaseholders that estate agent boards are not permitted on the building.',
			'groups'   => array(),
		),
		array(
			'ref'      => '11',
			'title'    => 'Metal Fences & Railings',
			'category' => 'Exterior & Grounds',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'Perimeter fencing and railings',
			'problem'  => 'Metal fences and railings around the building are rusting and looking tired.',
			'solution' => 'Sand and repaint all metal fences and railings.',
			'groups'   => array(),
		),
		array(
			'ref'      => '12',
			'title'    => 'Bin Store Rebuild (Structural)',
			'category' => 'Waste & Recycling',
			'priority' => 'high',
			'status'   => 'not-started',
			'location' => 'Bin store',
			'problem'  => 'The bin store brick doorway was previously boarded up, which looks unfinished. The store has no roof, so items get thrown in over the top, and its single open front makes it hard to separate waste from recycling or stop rubbish spreading outside it.',
			'solution' => 'Rebuild the brick doorway properly, removing a few bricks and finishing the opening so it reads as intentional rather than boarded up. Add a solid roof with ventilation to stop items being thrown in over the top. Rebuild the front of the store, dividing it into two sections, one for recycling and one for general waste, each with its own gate.',
			'groups'   => array( 'waste-bin-store' ),
		),
		array(
			'ref'      => '13',
			'title'    => 'Garden Waste Storage Enclosure',
			'category' => 'Waste & Recycling',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'Adjacent to fire exit',
			'problem'  => 'There is currently nowhere designated to store garden waste near the fire exit, making it harder to keep the grounds tidy.',
			'solution' => 'Rebuild the wall next to the fire exit and add a gate to create a dedicated, enclosed garden waste storage area.',
			'groups'   => array( 'waste-bin-store' ),
		),
		array(
			'ref'      => '14',
			'title'    => 'Fire Exit Door / Secondary Entrance',
			'category' => 'Fire Safety',
			'priority' => 'high',
			'status'   => 'not-started',
			'location' => 'Fire exit, rear of building',
			'problem'  => 'The fire exit door is not well suited to everyday use as a secondary entrance, so it gets propped open (a fire and security risk) when residents use it to reach the bin store.',
			'solution' => 'Replace the fire exit door with one more appropriate for a residential building, fitted with an external keypad. This lets residents on that corridor use it as a genuine second entrance/exit, including for bin store trips, without propping it open, since they can code themselves back in. The building would then effectively have two entrances, with the intercom (calling flats) staying only on the main entrance.',
			'groups'   => array( 'fire-safety-sprint' ),
		),
		array(
			'ref'      => '15',
			'title'    => 'Back Alleyway Clearance & Security Lighting',
			'category' => 'Exterior & Grounds',
			'priority' => 'medium',
			'status'   => 'not-started',
			'location' => 'Rear alleyway',
			'problem'  => 'The back alleyway is overgrown with weeds and is reportedly used for drug dealing, making it an unsafe, unwelcoming space.',
			'solution' => 'Clear the alleyway of overgrowth as a first step. Consider adding security lighting, checking first whether it would be intrusive for flats backing onto it.',
			'groups'   => array(),
		),
		array(
			'ref'      => '16',
			'title'    => 'Margate Caves Gate End – Wall & Steps',
			'category' => 'Exterior & Grounds',
			'priority' => 'wishlist',
			'status'   => 'not-started',
			'location' => 'Side road, Margate Caves gate end',
			'problem'  => 'The end of the side road by the bin stores leads to an unused gate for the Margate Caves. The adjacent passage now has a gate to stop flytipping, but the soil mound in front of it looks unsightly and the area feels neglected as you walk up.',
			'solution' => 'When the bin store is rebuilt, extend the same project to build a wall and steps at this end of the road to tidy the area and make it more presentable.',
			'groups'   => array( 'waste-bin-store' ),
		),
		array(
			'ref'      => '17',
			'title'    => 'Communal Carpets / Flooring',
			'category' => 'Flooring',
			'priority' => 'medium',
			'status'   => 'not-started',
			'location' => 'All communal corridors and stairs',
			'problem'  => 'Communal corridor carpets are worn and provide poor sound absorption; the back corridor noticeable echo is a good example. Existing carpet is also hard to keep clean and shows build-up over time.',
			'solution' => 'Replace with carpet or carpet tiles for sound absorption. Carpet tiles allow damaged sections to be replaced individually rather than whole runs, and support easier regular cleaning to prevent build-up. See the wider communal flooring programme for phasing.',
			'groups'   => array( 'communal-refresh' ),
		),
		array(
			'ref'      => '18',
			'title'    => 'Post Room – Post Boxes & Locks',
			'category' => 'Post Room',
			'priority' => 'medium',
			'status'   => 'not-started',
			'location' => 'Post room',
			'problem'  => 'Post box locks get damaged, sometimes by tenants themselves, with no consistent way to get them repaired or replaced. Electrical cupboard doors in the same room also do not fit well, making them hard to open and close.',
			'solution' => 'RTM to hold a master key/key set for all post box locks so replacements can be organised and paid for centrally rather than left to individual tenants. Refit the electrical cupboard doors so they open and close properly.',
			'groups'   => array( 'communal-refresh' ),
		),
		array(
			'ref'      => '19',
			'title'    => 'Post Room – Redecoration',
			'category' => 'Post Room',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'Post room',
			'problem'  => 'The pine-coloured wood doors and post box surround look dated. Large, unattractive signage is fixed to the electrical cupboards. There is also an unidentified grey box on the wall of unclear purpose.',
			'solution' => 'Paint the wood doors and post box surround a darker colour. Replace the oversized electrical cupboard signage with smaller, more appropriate signs. Confirm with XL whether the grey wall-mounted box is required; remove it if not.',
			'groups'   => array( 'communal-refresh' ),
		),
		array(
			'ref'      => '20',
			'title'    => 'Corridor – Notice Board & Wall Art',
			'category' => 'Corridors & Decor',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'First corridor, other communal corridors',
			'problem'  => 'The residents notice board is the first thing visible on entering the first corridor, which is not a great first impression.',
			'solution' => 'Relocate the notice board to next to the lifts. Replace it at the entrance with a framed picture, and add framed pictures elsewhere in the corridors. Suggested theme: historic photos of the building, which is uncontroversial and reflects its character.',
			'groups'   => array( 'communal-refresh' ),
		),
		array(
			'ref'      => '21',
			'title'    => 'Corridor – Wall Decoration Scheme',
			'category' => 'Corridors & Decor',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'All communal corridors',
			'problem'  => 'Communal walls are currently brilliant white, which shows scuff marks easily and can feel stark and unforgiving.',
			'solution' => 'Repaint with a dado rail scheme: a darker colour below the rail (including skirting, to hide scuff marks) and an off-white or beige above and on the ceiling.',
			'groups'   => array( 'communal-refresh' ),
		),
		array(
			'ref'      => '22',
			'title'    => 'Communal Lighting – Sensor Fittings',
			'category' => 'Lighting',
			'priority' => 'high',
			'status'   => 'arranging-quote',
			'location' => 'All communal corridors and stairwells',
			'problem'  => 'Current communal lighting is dated and not motion-sensored.',
			'solution' => 'Already specified separately: sensor lighting with a specific fitting design (see lighting specification document). Logged here for completeness in this list.',
			'groups'   => array( 'communal-refresh' ),
		),
		array(
			'ref'      => '23',
			'title'    => 'Stairs – Cleaning & Tread Replacement',
			'category' => 'Flooring',
			'priority' => 'medium',
			'status'   => 'not-started',
			'location' => 'All stairwells',
			'problem'  => 'Stairs have sticky residue build-up that regular cleaning is not addressing, and treads need replacing.',
			'solution' => 'Deep clean stairs to remove residue, then fit new treads.',
			'groups'   => array( 'communal-refresh' ),
		),
		array(
			'ref'      => '24',
			'title'    => 'Entrance & Floor Wayfinding Signage',
			'category' => 'Signage',
			'priority' => 'low',
			'status'   => 'not-started',
			'location' => 'Main entrance, each floor landing',
			'problem'  => 'Delivery drivers and visitors have no signage showing which flats are on which floor, causing delays and confusion.',
			'solution' => 'Add small signage at the entrance listing flat numbers by floor, plus small signage on each floor showing which apartments are on that corridor.',
			'groups'   => array(),
		),
		array(
			'ref'      => '25',
			'title'    => 'Ground Floor Fire Door Replacement',
			'category' => 'Fire Safety',
			'priority' => 'high',
			'status'   => 'not-started',
			'location' => 'Ground floor',
			'problem'  => 'The ground floor fire door does not fit properly and is a different style to all other doors in the building.',
			'solution' => 'Replace with a fire door that matches the style used elsewhere in the building and fits the opening correctly.',
			'groups'   => array( 'fire-safety-sprint' ),
		),
	);
}
