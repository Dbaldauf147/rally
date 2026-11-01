// The wedding checklist — what to do, counting backward from the date.
//
// The list below is the starting point, not the law: it seeds an account that
// has never edited one, and from then on the stored document carries its own
// phases and tasks. Ticks stay a separate map keyed by phase and task id, so
// rewording a task keeps its tick and an account that only ever stored ticks
// still reads back correctly against the seed.
//
// Ids are explicit slugs, not positions. A checklist keyed by index would move
// everyone's ticks the first time a task was inserted or reworded, which is
// exactly the sort of silent corruption you don't notice until the week of.
//
// `note` is the guidance that came with a task — kept beside it rather than
// folded into the text, so the task stays scannable and the reasoning is still
// there when you need it. `milestone` marks the few items everything else
// hangs off: booking the venue, mailing the invitations, the licence.

/* `steps` break a task into the concrete things you actually do, in order.

   Written as plain strings and numbered s1, s2, … by position, here, once.
   Those ids are what a ticked step is stored under, so a task's steps are
   append-only: a step added to the seed later takes the next free number
   rather than renumbering the ones after it, or every tick below it moves. */
const S = (...texts) => texts.map((text, i) => ({ id: `s${i + 1}`, text }));

// Bumped when the built-in list gains content an already-saved list should
// pick up. See upgradeSeed.
export const SEED_VERSION = 2;

// The sections version 2 added, for upgradeSeed to append to a saved list.
const ADDED_IN_V2 = ['day', 'after'];

export const SEED_PHASES = [
  {
    id: 'now',
    title: 'Now, before the date exists',
    when: 'allow 1–3 months',
    tasks: [
      {
        id: 'numbers',
        text: 'Settle the three numbers: budget, guest list, season',
        steps: S(
          'Each of you write down, separately, the total you’d be comfortable spending',
          'Ask any family who want to contribute how much, when, and whether it comes with expectations about the guest list',
          'Agree one total budget, and hold back a 10% buffer for overruns',
          'Each draft a must-invite list, then merge them into one rough headcount range',
          'Pick a season and two or three candidate months',
          'Write all three numbers down where you’ll both see them',
        ),
      },
      {
        id: 'vision',
        text: 'Agree on a rough vision: formal or relaxed, indoor or outdoor, city or country',
        steps: S(
          'Each save 10–20 photos of weddings you like, without comparing notes',
          'Put them side by side and list what keeps showing up',
          'Decide formal or relaxed, indoor or outdoor, city or country',
          'Name your three non-negotiables, and the things you genuinely don’t care about',
          'Write a one-paragraph description of the day to send to venues and vendors',
        ),
      },
      {
        id: 'planner',
        text: 'Decide whether you’re hiring a full planner',
        note: 'At 120–250 guests, if you both work full-time, this is worth serious consideration. If not a full planner, commit now to hiring a day-of coordinator later.',
        steps: S(
          'List what you’d want to hand off: vendor search, contracts, budget, design, the day itself',
          'Get quotes from 2–3 full planners and 2–3 day-of coordinators',
          'Ask each what’s included, how many hours, and how many weddings a year they take',
          'Call two references for whoever you favour',
          'If hiring a full planner, sign before touring venues — they’ll know which ones fit',
          'If not, put “book a day-of coordinator” on the calendar for 8 months out',
        ),
      },
      {
        id: 'tour-venues',
        text: 'Research and tour venues',
        note: 'Tour at least four before deciding.',
        steps: S(
          'Shortlist 6–8 venues that seat your headcount with room for a dance floor',
          'Email each for open dates in your season, pricing, and food-and-drink minimums',
          'Tour at least four, with the same list of questions for each',
          'Ask what’s included: tables, chairs, linens, catering, an on-site coordinator',
          'Ask about curfew, noise limits, the rain plan, accessibility, parking, and load-in times',
          'Ask which vendors are required or banned',
          'Compare total cost, not the venue fee: minimums, service charge, tax, and required vendors',
        ),
      },
      {
        id: 'book-venue',
        text: 'Book the venue. Your date is now set.',
        note: 'Everything below counts backward from it.',
        milestone: true,
        steps: S(
          'Choose a first-choice date and a backup',
          'Read the contract: cancellation terms, deposit, payment schedule, insurance requirement, exclusive vendors',
          'Sign, pay the deposit, and get a countersigned copy back',
          'Put every payment due date on a shared calendar',
          'Tell close family and the wedding party the date',
        ),
      },
      {
        id: 'insurance',
        text: 'Take out wedding insurance if the venue requires it or your deposits are large',
        steps: S(
          'Check whether the venue requires liability insurance, and the minimum cover',
          'Add up how much you have in deposits at risk',
          'Get 2–3 quotes for liability and cancellation cover',
          'Buy the policy and send the certificate to the venue',
        ),
      },
      {
        id: 'admin',
        text: 'Set up a shared spreadsheet and a dedicated email address for wedding correspondence',
        steps: S(
          'Create one email address you can both read',
          'Make a shared spreadsheet with tabs for budget, vendors, and payments',
          'Add the venue’s contract, deposit, and payment dates',
          'Use the new address for every vendor inquiry from here on',
        ),
      },
    ],
  },
  {
    id: 'm12',
    title: '12–10 months out',
    tasks: [
      {
        id: 'photo',
        text: 'Book photographer and videographer',
        note: 'Good ones book 12–18 months ahead for peak dates.',
        steps: S(
          'Shortlist five photographers whose full galleries — not just highlight reels — you love',
          'Check who’s free on your date',
          'Compare packages: hours, second shooter, engagement shoot, delivery time, album',
          'Video-call your top two',
          'Read the contract (deposit, image rights, delivery date) and sign',
          'Repeat for a videographer, if you’re having one',
        ),
      },
      {
        id: 'caterer',
        text: 'Book caterer, if not in-house at the venue',
        steps: S(
          'Check whether the venue has an approved list',
          'Get quotes from three caterers for your headcount',
          'Ask what’s included: staff, rentals, bar service, cake cutting, service charge',
          'Decide the service style: plated, buffet, family style, or stations',
          'Sign and pay the deposit — the tasting comes later',
        ),
      },
      {
        id: 'music',
        text: 'Book band or DJ',
        steps: S(
          'Decide band or DJ, and whether the ceremony needs its own music',
          'Watch live footage, or go to a showcase',
          'Check they’ve played your venue or will do a site visit; confirm power and sound limits',
          'Ask about MC duties, breaks, the do-not-play list, and overtime rates',
          'Sign and pay the deposit',
        ),
      },
      {
        id: 'officiant',
        text: 'Book officiant',
        steps: S(
          'Decide religious, civil, or a friend ordained for the day',
          'Check your state’s rules on who can legally sign the license',
          'Meet them and agree on the ceremony’s length and tone',
          'Book them and confirm the fee and any travel costs',
        ),
      },
      {
        id: 'party',
        text: 'Ask your wedding party',
        steps: S(
          'Agree how many people each of you will ask',
          'Ask each person in person or on the phone, not by group text',
          'Tell them up front roughly what it will cost them: attire, travel, the bachelor and bachelorette parties',
          'Start a group chat once everyone has said yes',
        ),
      },
      {
        id: 'hotels',
        text: 'Reserve hotel room blocks',
        note: 'At your size you likely need 2–3 hotels at different price points.',
        steps: S(
          'Pick 2–3 hotels near the venue at different price points',
          'Ask each for a courtesy block with no penalty for unbooked rooms',
          'Negotiate the group rate and the cut-off date (usually 30 days out)',
          'Sign the block agreements and put each cut-off date on the calendar',
          'Get the booking links for the website',
        ),
      },
      {
        id: 'website',
        text: 'Build the wedding website',
        steps: S(
          'Pick a platform and a short, easy-to-type address',
          'Add the date, the venue, and the hotel booking links',
          'Add travel, parking, and dress-code details',
          'Set up online RSVPs, if you’re using them',
          'Leave space for the registry, added once it exists',
        ),
      },
      {
        id: 'save-the-dates',
        text: 'Send save-the-dates, especially if it’s a destination or holiday weekend',
        steps: S(
          'Lock the guest list — everyone who gets a save-the-date has to get an invitation',
          'Collect every mailing address (the guest list shows which are still missing)',
          'Order or design the cards, with the website address on them',
          'Mail them 8–12 months out, or 12 for a destination wedding',
        ),
      },
    ],
  },
  {
    id: 'm10',
    title: '10–8 months out',
    tasks: [
      {
        id: 'dress',
        text: 'Shop for and order the wedding dress',
        note: 'Ordering plus alterations takes 6–9 months.',
        steps: S(
          'Set a budget that includes alterations, veil, and accessories',
          'Book 2–3 bridal shop appointments, and bring no more than two people',
          'Choose and order — get the delivery date in writing',
          'Ask what alterations will cost and when to book the first fitting',
        ),
      },
      {
        id: 'florist',
        text: 'Book florist',
        steps: S(
          'Gather photos of flowers and colours you like',
          'Send your vision and budget to 2–3 florists for quotes',
          'Agree the full list: bouquets, boutonnieres, ceremony pieces, centerpieces',
          'Sign and pay the deposit',
        ),
      },
      {
        id: 'cake',
        text: 'Book cake or dessert vendor',
        steps: S(
          'Decide a cake, a dessert table, or both',
          'Book tastings with 2–3 bakers',
          'Check the venue’s cake-cutting fee and delivery rules',
          'Order, with enough servings for your headcount',
        ),
      },
      {
        id: 'rentals',
        text: 'Book rentals if the venue doesn’t include them',
        steps: S(
          'Get the venue’s exact list of what’s included',
          'List what’s missing: tables, chairs, linens, tableware, lighting, tent, restrooms',
          'Get quotes from two rental companies',
          'Book, and confirm delivery and pickup times with the venue',
        ),
      },
      {
        id: 'beauty',
        text: 'Book hair and makeup team',
        note: 'At your size you may need a team of 2–4 to get everyone ready on time.',
        steps: S(
          'Count who needs hair and makeup, and how long each takes',
          'Ask artists how many people they’ll bring to finish on time',
          'Check they’ll travel to where you’re getting ready',
          'Book, pay the deposit, and schedule the trial',
        ),
      },
      {
        id: 'honeymoon',
        text: 'Start honeymoon planning; check passport expiration dates now',
        steps: S(
          'Agree the budget, dates, and kind of trip',
          'Check both passports are valid for at least six months past your return',
          'Check visa and vaccine rules for where you’re going',
          'Book anything that sells out: flights, the main hotel',
          'If either of you is changing your name, book travel in the name on your passport',
        ),
      },
    ],
  },
  {
    id: 'm8',
    title: '8–6 months out',
    tasks: [
      {
        id: 'rehearsal-venue',
        text: 'Book rehearsal dinner venue',
        steps: S(
          'Decide who’s hosting and who’s invited: wedding party, family, out-of-towners?',
          'Pick a restaurant or space near the ceremony venue',
          'Reserve the date and confirm the minimum spend',
        ),
      },
      {
        id: 'registry',
        text: 'Register for gifts',
        steps: S(
          'Walk through your home and list what you actually need',
          'Pick one or two registries, and decide on a cash or honeymoon fund',
          'Add items across a range of prices',
          'Link the registry on the website',
        ),
      },
      {
        id: 'tasting',
        text: 'Attend menu tasting and lock the menu',
        steps: S(
          'Schedule the tasting with the caterer',
          'Choose appetizers, mains, and sides',
          'Plan for the dietary needs you already know of: vegetarian, allergies, kids’ meals',
          'Decide the bar: open, beer and wine, signature drinks',
          'Get the final menu and per-head price in writing',
        ),
      },
      {
        id: 'suits',
        text: 'Order suits or tuxes',
        steps: S(
          'Pick a style and colour that matches the formality',
          'Decide rent or buy, and whether the groomsmen match',
          'Get everyone measured, and send out-of-towners the measuring instructions',
          'Place the order and note the pickup date',
        ),
      },
      {
        id: 'paper',
        text: 'Order invitations and all paper goods',
        steps: S(
          'List what’s needed: invitations, RSVP cards, details cards, envelopes',
          'Choose a stationer, or design your own',
          'Proofread names, date, time, and venue — then have someone else proofread',
          'Order 10–15% extra for keepsakes and mistakes',
          'Take one fully assembled invitation to the post office to weigh it for postage',
        ),
      },
      {
        id: 'transport',
        text: 'Book transportation: guest shuttles, wedding party transport, getaway car',
        steps: S(
          'Work out who needs moving: guests between hotels and venue, the wedding party, the two of you',
          'Get quotes for shuttles sized to your headcount',
          'Book the getaway car',
          'Get every pickup time and address confirmed in writing',
        ),
      },
      {
        id: 'entertainment',
        text: 'Book any additional entertainment (ceremony musicians, cocktail hour trio, photo booth)',
        steps: S(
          'Decide what you want: ceremony musicians, cocktail-hour music, a photo booth, lawn games',
          'Check the venue allows it and has the space and power',
          'Book, and confirm set-up times',
        ),
      },
      {
        id: 'fitting-1',
        text: 'First dress fitting',
        steps: S(
          'Book the appointment with the seamstress',
          'Bring the shoes and undergarments you’ll wear on the day',
          'Book the next fitting before you leave',
        ),
      },
    ],
  },
  {
    id: 'm6',
    title: '6–4 months out',
    tasks: [
      {
        id: 'bands',
        text: 'Buy wedding bands',
        steps: S(
          'Get your ring sizes measured — on a warm day, since fingers swell in heat',
          'Shop together and decide metal, width, and fit',
          'Order, allowing 4–6 weeks for engraving or resizing',
          'Add them to your home or renters insurance',
        ),
      },
      {
        id: 'ceremony',
        text: 'Plan the ceremony: readings, vows, processional order, music',
        steps: S(
          'Sit down with your officiant to agree the structure and length',
          'Choose readings, and ask your readers',
          'Set the processional order: who walks, with whom, in what order',
          'Pick music for the processional, the entrance, and the recessional',
          'Decide on any traditions or rituals you want included',
        ),
      },
      {
        id: 'beauty-trial',
        text: 'Hair and makeup trial',
        note: 'Do it on the same day as an engagement shoot if you’re doing one.',
        steps: S(
          'Bring photos of looks you like, and a photo of the dress',
          'Take photos of the result in daylight and with flash',
          'Write down exactly what was done so it can be repeated on the day',
        ),
      },
      {
        id: 'custom',
        text: 'Order favors, signage, guest book, anything custom',
        steps: S(
          'List the signs: welcome, seating chart, bar menu, programs',
          'Choose a guest book, or an alternative',
          'Decide on favors, if any — one per guest or one per household',
          'Order whatever has the longest lead time first',
        ),
      },
      {
        id: 'license-research',
        text: 'Research your marriage license requirements',
        note: 'Waiting period, expiration window, documents needed, whether both parties must appear.',
        steps: S(
          'Find the county or city clerk where you’re marrying',
          'Note the waiting period, how long it’s valid, the fee, and whether you both have to be there',
          'List the documents you need: ID, birth certificates, any divorce decrees',
          'Put the date to apply on the calendar',
        ),
      },
      {
        id: 'party-gifts',
        text: 'Buy wedding party gifts',
        steps: S(
          'Set a budget per person',
          'Choose and order, with time for any personalisation',
          'Write a note for each one',
        ),
      },
      {
        id: 'rehearsal-invites',
        text: 'Confirm rehearsal dinner guest list and send invitations',
        steps: S(
          'Finalise the list with whoever is hosting',
          'Send the invitations, or a group message with the time and place',
          'Collect RSVPs and dietary needs',
        ),
      },
    ],
  },
  {
    id: 'm3',
    title: '3 months out',
    tasks: [
      {
        id: 'mail-invitations',
        text: 'Mail invitations',
        note: 'Standard is 6–8 weeks before the wedding; 10–12 weeks for destination. Set the RSVP deadline 3–4 weeks before the wedding.',
        milestone: true,
        steps: S(
          'Check every mailing address on the guest list',
          'Set the RSVP deadline 3–4 weeks before the wedding',
          'Address, stuff, and stamp — including stamped RSVP envelopes',
          'Mail one to yourselves first to check it arrives intact',
          'Mail the rest 6–8 weeks before the wedding, or 10–12 for a destination',
        ),
      },
      {
        id: 'timeline',
        text: 'Draft the day-of timeline with your coordinator',
        steps: S(
          'Start from the ceremony time and work backward and forward',
          'Block in getting ready, photos, ceremony, cocktail hour, dinner, toasts, first dance, cake, send-off',
          'Check the sunset time if you want golden-hour photos',
          'Share the draft with your photographer and band or DJ for comments',
        ),
      },
      {
        id: 'fitting-2',
        text: 'Second dress fitting',
        steps: S(
          'Bring the shoes and undergarments again',
          'Check you can sit, dance, and lift your arms',
          'Learn how the bustle works, and teach someone who’ll be with you',
        ),
      },
      {
        id: 'vows',
        text: 'Write vows',
        steps: S(
          'Agree on length and tone with each other',
          'Write a first draft',
          'Read it aloud and time it',
          'Copy the final version into a vow book',
        ),
      },
      {
        id: 'script',
        text: 'Finalize the ceremony script with your officiant',
        steps: S(
          'Get a full draft from your officiant',
          'Check every name, how it’s pronounced, and the order of the readings',
          'Confirm it includes any wording your state legally requires',
          'Sign off on the final version',
        ),
      },
      {
        id: 'honeymoon-confirm',
        text: 'Confirm honeymoon bookings',
        steps: S(
          'Confirm flights, hotels, and transfers',
          'Arrange pet care, a house-sitter, and a mail hold',
          'Tell your banks you’ll be travelling',
          'Buy travel insurance, if you want it',
        ),
      },
    ],
  },
  {
    id: 'm2',
    title: '2 months out',
    tasks: [
      {
        id: 'rsvps',
        text: 'Track RSVPs',
        note: 'Expect to chase 20–30% of your list by phone or text; this is normal and unavoidable.',
        steps: S(
          'Log every RSVP on the guest list as it comes in',
          'A few days after the deadline, call or text everyone who hasn’t answered',
          'Record meal choices and dietary needs',
          'Update the headcount',
        ),
      },
      {
        id: 'seating-start',
        text: 'Start the seating chart',
        steps: S(
          'Get the floor plan and table sizes from the venue',
          'Group guests by how they know you',
          'Seat family and the wedding party first',
          'Draft a table-by-table layout',
        ),
      },
      {
        id: 'menu-counts',
        text: 'Final menu counts by dish type if you’re doing plated service',
        steps: S(
          'Tally meal choices from the RSVPs',
          'List every allergy against the guest’s name',
          'Send the counts to the caterer',
        ),
      },
      {
        id: 'vendor-confirm',
        text: 'Confirm all vendor arrival times, load-in windows, and contact numbers',
        steps: S(
          'Make a vendor contact sheet: name, phone, arrival time',
          'Email each vendor to confirm the date, arrival time, and load-in window',
          'Get the venue’s load-in rules and pass them on',
          'Confirm each vendor’s final balance and due date',
        ),
      },
      {
        id: 'cards',
        text: 'Order or write place cards, escort cards, menus',
        steps: S(
          'Decide on escort cards or a single seating-chart sign',
          'Order or write the cards once the seating chart is settled',
          'Order printed menus if you’re doing plated service',
        ),
      },
      {
        id: 'shoes',
        text: 'Break in your shoes',
        steps: S(
          'Wear them around the house for an hour at a time',
          'Scuff the soles so they don’t slip',
          'Buy a pair of flats for later in the night',
        ),
      },
    ],
  },
  {
    id: 'm1',
    title: '1 month out',
    tasks: [
      {
        id: 'license',
        text: 'Get the marriage license',
        note: 'Time it inside the validity window; many expire in 30–90 days.',
        milestone: true,
        steps: S(
          'Gather the documents you listed',
          'Go to the clerk together, inside the validity window',
          'Pay the fee and collect the license',
          'Put it somewhere safe until it goes to your officiant',
        ),
      },
      {
        id: 'headcount',
        text: 'Give final headcount to caterer',
        note: 'Usually due 7–14 days out; confirm the exact deadline.',
        steps: S(
          'Confirm the caterer’s exact deadline',
          'Take the final number from the RSVPs, and add vendor meals',
          'Send the headcount and meal split in writing',
        ),
      },
      {
        id: 'seating-finish',
        text: 'Finish the seating chart',
        steps: S(
          'Fit in the late RSVPs',
          'Finalise every table',
          'Send the final chart to the venue and your coordinator',
        ),
      },
      {
        id: 'fitting-final',
        text: 'Final dress fitting',
        steps: S(
          'Try on the whole outfit with shoes and accessories',
          'Collect the dress, or arrange delivery',
          'Store it hanging, in a breathable bag',
        ),
      },
      {
        id: 'payments',
        text: 'Make final payments per each contract’s schedule',
        steps: S(
          'List every balance due and its date',
          'Pay each one and keep the receipts',
          'Note which vendors are paid on the day, and by whom',
        ),
      },
      {
        id: 'send-timeline',
        text: 'Send the finished day-of timeline and vendor contact sheet to every vendor and every member of the wedding party',
        steps: S(
          'Finish the day-of timeline',
          'Put every vendor’s contact details on one sheet',
          'Email both to each vendor and the wedding party',
          'Print copies for your coordinator and one family member',
        ),
      },
      {
        id: 'tips',
        text: 'Prepare tip envelopes: label each one, put cash inside, and hand the whole set to one trusted person',
        steps: S(
          'List every vendor who should get a tip, with the amount',
          'Withdraw the cash',
          'Put each tip in its own labelled envelope',
          'Hand the set and the list to one trusted person',
        ),
      },
    ],
  },
  {
    id: 'week',
    title: 'Week of',
    tasks: [
      {
        id: 'delegate',
        text: 'Delegate everything',
        note: 'Write down who is doing what and when.',
        steps: S(
          'List every small job on the day: rings, license, decor set-up, gifts, payments, clean-up',
          'Assign each job to a named person',
          'Send each person their jobs in writing',
        ),
      },
      {
        id: 'kit',
        text: 'Pack the emergency kit',
        steps: S(
          'Sewing kit, safety pins, stain remover, fashion tape',
          'Pain relief, plasters, tissues, antacids',
          'Phone charger, snacks, and water',
          'Give it to someone who’ll be with you all day',
        ),
      },
      {
        id: 'welcome-bags',
        text: 'Drop off welcome bags at hotels',
        steps: S(
          'Assemble the bags: water, snacks, the weekend schedule, a map',
          'Label each one with the guest’s name',
          'Drop them at each front desk with a list of names',
        ),
      },
      {
        id: 'deliver',
        text: 'Deliver decor, signage, favors, and place cards to the venue or coordinator',
        steps: S(
          'Pack everything in boxes labelled by where it goes',
          'Write a list of what goes where',
          'Drop it off with the venue or coordinator and walk them through the list',
        ),
      },
      {
        id: 'final-headcount',
        text: 'Confirm final headcount and any last dietary changes',
        steps: S(
          'Catch up on any late changes',
          'Send the final count and dietary list to the caterer and the venue',
        ),
      },
      {
        id: 'pack',
        text: 'Pack for the honeymoon',
        steps: S(
          'Passports, tickets, and booking confirmations',
          'Clothes and toiletries',
          'Leave the bags with someone who’ll bring them to where you’re staying',
        ),
      },
      {
        id: 'rehearsal',
        text: 'Rehearsal and rehearsal dinner',
        steps: S(
          'Run the processional and recessional with everyone there',
          'Hand out the wedding party gifts',
          'Enjoy the dinner, and make it an early night',
        ),
      },
      {
        id: 'rings',
        text: 'Give the rings, license, and vow books to a specific named person',
        steps: S(
          'Choose one named person to hold the rings',
          'Give the license to your officiant',
          'Give the vow books to your officiant or the person holding the rings',
        ),
      },
    ],
  },
  {
    id: 'day',
    title: 'The day of',
    tasks: [
      { id: 'breakfast', text: 'Eat a proper breakfast, and keep water nearby all day' },
      {
        id: 'hand-offs',
        text: 'Check the hand-offs happened: rings, license, vow books, tip envelopes, emergency kit',
        steps: S(
          'Rings and vow books are with their named person',
          'The license is with your officiant',
          'Tip envelopes and final payments are with their named person',
          'The emergency kit is with someone staying beside you',
        ),
      },
      { id: 'phone', text: 'Hand your phone to someone, and let the coordinator run the timeline' },
      {
        id: 'sign-license',
        text: 'Sign the marriage license',
        milestone: true,
        steps: S(
          'Sign right after the ceremony, with your officiant and witnesses',
          'Check every field is filled in and nothing is crossed out',
          'Confirm who is returning it to the clerk, and by when',
        ),
      },
      { id: 'together', text: 'Take ten minutes alone together after the ceremony' },
      { id: 'pack-up', text: 'Make sure someone collects gifts, cards, decor, and your belongings at the end of the night' },
    ],
  },
  {
    id: 'after',
    title: 'After the wedding',
    tasks: [
      {
        id: 'file-license',
        text: 'Make sure the signed license is filed, and order certified copies',
        steps: S(
          'Confirm with the clerk that the license was received',
          'Order 2–3 certified copies of the marriage certificate',
        ),
      },
      {
        id: 'returns',
        text: 'Return rentals and attire, and collect anything left at the venue',
        steps: S(
          'Return rented suits, decor, and anything borrowed',
          'Pick up anything left at the venue',
          'Check that rental deposits come back',
        ),
      },
      {
        id: 'thank-yous',
        text: 'Send thank-you notes',
        note: 'Aim to have them all out within three months.',
        steps: S(
          'Log every gift and who it’s from as you open them',
          'Write a few notes a day rather than all at once',
          'Mail them, and tick each one off the log',
        ),
      },
      { id: 'dress-care', text: 'Have the dress cleaned and preserved' },
      {
        id: 'name-change',
        text: 'Change your name, if either of you is',
        steps: S(
          'Social Security, with a certified copy of the certificate',
          'Driver’s license or state ID',
          'Passport',
          'Banks, credit cards, employer, and payroll',
          'Insurance, doctors, utilities, and everything else',
        ),
      },
      {
        id: 'photos',
        text: 'Back up the photos, and order an album or prints',
        steps: S(
          'Download the full gallery and keep two copies',
          'Share the gallery with family and the wedding party',
          'Choose and order the album or prints',
        ),
      },
      { id: 'reviews', text: 'Leave reviews for the vendors you loved' },
    ],
  },
];

// A task's key in the ticked set. Phase-scoped so two phases can both have a
// "final fitting" without sharing a tick.
export const taskKey = (phaseId, taskId) => `${phaseId}.${taskId}`;

// A step's key — under its task's, so it can never collide with another task.
export const stepKey = (phaseId, taskId, stepId) => `${phaseId}.${taskId}.${stepId}`;

/* Ids for anything added later.

   Prefixed so a hand-written seed id and a generated one can never collide,
   and generated once rather than derived from the text — renaming a task must
   not move its tick. */
let seq = 0;
export function makeId(prefix = 't') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  } catch { /* fall through */ }
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}${seq}`;
}

export function normalizeTask(raw) {
  return {
    id: String(raw?.id || makeId('t')),
    text: String(raw?.text ?? '').trim(),
    note: String(raw?.note ?? '').trim(),
    milestone: Boolean(raw?.milestone),
    steps: (Array.isArray(raw?.steps) ? raw.steps : []).map(normalizeStep),
  };
}

export function normalizeStep(raw) {
  return {
    id: String(raw?.id || makeId('s')),
    text: String(raw?.text ?? '').trim(),
  };
}

export function normalizePhase(raw) {
  return {
    id: String(raw?.id || makeId('p')),
    title: String(raw?.title ?? '').trim(),
    when: String(raw?.when ?? '').trim(),
    tasks: (Array.isArray(raw?.tasks) ? raw.tasks : []).map(normalizeTask),
  };
}

/* The stored document: the list itself, plus which tasks are ticked.

   Ticks stay a separate map keyed by phase and task id rather than a flag on
   the task. That's what lets the content become editable without disturbing
   anything already ticked — an account that only ever stored ticks reads back
   with the built-in list underneath them, unchanged.

   A missing `phases` means the account predates editing, so it gets the seed.
   An empty array is a deliberately emptied list and is left empty.

   A step's tick is stored only while its task is part-way done. A finished
   task is the task's own key and nothing else — every step under it reads as
   done through stepDone — so a tick saved before steps existed still means
   the whole thing, and the map never holds a task and its steps saying two
   different things. */
export function normalizeChecklist(raw) {
  const stored = Array.isArray(raw?.phases);
  const version = stored ? Number(raw?.seedVersion) || 1 : SEED_VERSION;
  const phases = upgradeSeed((stored ? raw.phases : SEED_PHASES).map(normalizePhase), version);
  const known = new Set();
  phases.forEach((p) => p.tasks.forEach((t) => {
    known.add(taskKey(p.id, t.id));
    t.steps.forEach((s) => known.add(stepKey(p.id, t.id, s.id)));
  }));
  const done = {};
  const rawDone = raw?.done;
  if (rawDone && typeof rawDone === 'object') {
    Object.entries(rawDone).forEach(([key, value]) => {
      // A tick against a task that no longer exists is dropped, so deleting a
      // task can't leave a phantom behind inflating the count.
      if (value && known.has(key)) done[key] = true;
    });
  }
  // A finished task needs nothing under it.
  phases.forEach((p) => p.tasks.forEach((t) => {
    if (done[taskKey(p.id, t.id)]) t.steps.forEach((s) => { delete done[stepKey(p.id, t.id, s.id)]; });
  }));
  return { phases, done, seedVersion: SEED_VERSION };
}

/* Bring a list saved under an older seed up to date, once.

   Every tick saves the whole list, so an account that has touched the
   checklist carries its own copy of it and would never see new built-in
   content. This adds what the newer seed brought — the steps under each
   built-in task, the sections added since — without undoing anything the
   owner changed: a task that already has steps keeps them, a task or section
   they deleted stays deleted, and the version stamp stops it running again
   on a list they have since edited by hand. */
function upgradeSeed(phases, version) {
  if (version >= SEED_VERSION) return phases;
  const seedById = new Map(SEED_PHASES.map((p) => [p.id, p]));
  const out = phases.map((p) => {
    const seedPhase = seedById.get(p.id);
    if (!seedPhase) return p;
    return {
      ...p,
      tasks: p.tasks.map((t) => {
        if (t.steps.length) return t;
        const seedTask = seedPhase.tasks.find((x) => x.id === t.id);
        return seedTask?.steps ? { ...t, steps: seedTask.steps.map(normalizeStep) } : t;
      }),
    };
  });
  /* The day-of and after sections follow Week of, so they go in right after
     it — and only when it's there. A list without it has been emptied or
     rebuilt by hand, and growing two sections it never asked for would undo
     exactly the decision the owner made. */
  const weekAt = out.findIndex((p) => p.id === 'week');
  if (version < 2 && weekAt >= 0) {
    const missing = ADDED_IN_V2
      .filter((id) => !out.some((p) => p.id === id))
      .map((id) => normalizePhase(seedById.get(id)));
    out.splice(weekAt + 1, 0, ...missing);
  }
  return out;
}

export const seedChecklist = () => normalizeChecklist({ phases: SEED_PHASES, done: {} });

export const allTasks = (phases) =>
  phases.flatMap((p) => p.tasks.map((t) => ({ ...t, phaseId: p.id, key: taskKey(p.id, t.id) })));

export const totalTasks = (phases) => phases.reduce((n, p) => n + p.tasks.length, 0);

export const totalSteps = (phases) =>
  phases.reduce((n, p) => n + p.tasks.reduce((m, t) => m + t.steps.length, 0), 0);

export const isDone = (done, key) => Boolean(done?.[key]);

// A step is done when it is ticked, or when its whole task is.
export const stepDone = (done, phaseId, task, stepId) =>
  isDone(done, taskKey(phaseId, task.id)) || isDone(done, stepKey(phaseId, task.id, stepId));

export function stepProgress(phaseId, task, done) {
  const total = task.steps.length;
  const complete = task.steps.filter((s) => stepDone(done, phaseId, task, s.id)).length;
  return { complete, total };
}

const findTask = (phases, key) => allTasks(phases).find((t) => t.key === key) || null;

// Ticking a task ticks every step under it; unticking it clears them all.
export function toggleTask(list, key) {
  const { phases, done } = normalizeChecklist(list);
  const next = { ...done };
  const task = findTask(phases, key);
  if (!task) return { phases, done: next, seedVersion: SEED_VERSION };
  const wasDone = Boolean(next[key]);
  task.steps.forEach((s) => { delete next[stepKey(task.phaseId, task.id, s.id)]; });
  if (wasDone) delete next[key];
  else next[key] = true;
  return { phases, done: next, seedVersion: SEED_VERSION };
}

/* Tick or untick one step.

   Ticking the last open step finishes the task; unticking a step of a
   finished task reopens it with every other step still ticked, rather than
   throwing away the rest of the work. */
export function toggleStep(list, phaseId, taskId, stepId) {
  const { phases, done } = normalizeChecklist(list);
  const next = { ...done };
  const tKey = taskKey(phaseId, taskId);
  const task = findTask(phases, tKey);
  if (!task || !task.steps.some((s) => s.id === stepId)) return { phases, done: next, seedVersion: SEED_VERSION };
  const sKey = stepKey(phaseId, taskId, stepId);
  if (next[tKey]) {
    delete next[tKey];
    task.steps.forEach((s) => { if (s.id !== stepId) next[stepKey(phaseId, taskId, s.id)] = true; });
  } else if (next[sKey]) {
    delete next[sKey];
  } else {
    next[sKey] = true;
    if (task.steps.every((s) => next[stepKey(phaseId, taskId, s.id)])) {
      task.steps.forEach((s) => { delete next[stepKey(phaseId, taskId, s.id)]; });
      next[tKey] = true;
    }
  }
  return { phases, done: next, seedVersion: SEED_VERSION };
}

export function phaseProgress(phase, done) {
  const total = phase.tasks.length;
  const complete = phase.tasks.filter((t) => isDone(done, taskKey(phase.id, t.id))).length;
  return { complete, total, finished: total > 0 && complete === total };
}

// Counted off the tasks, not the keys in `done`, which also hold part-way steps.
export function overallProgress(list) {
  const { phases, done } = normalizeChecklist(list);
  const total = totalTasks(phases);
  const complete = allTasks(phases).filter((t) => isDone(done, t.key)).length;
  return { complete, total, pct: total ? Math.round((complete / total) * 100) : 0 };
}

/* The first thing still outstanding, in timeline order.

   The list is long enough that "where was I" is a real question, and the answer
   is almost always the earliest unfinished task rather than anything clever.
   `nextStep` is the first open step inside it, with its number, when it has
   steps — the concrete thing to do this week. */
export function nextUp(list) {
  const { phases, done } = normalizeChecklist(list);
  const task = allTasks(phases).find((t) => !isDone(done, t.key));
  if (!task) return null;
  const index = task.steps.findIndex((s) => !stepDone(done, task.phaseId, task, s.id));
  return {
    ...task,
    nextStep: index >= 0 ? { ...task.steps[index], number: index + 1, of: task.steps.length } : null,
  };
}

// --- editing the list ------------------------------------------------------
//
// Every one of these takes the whole document and hands back a new one, so a
// change that has to touch both the phases and the ticks can't half-apply.
// Removing anything runs back through normalizeChecklist, which is what prunes
// the ticks that came with it.

const mapPhase = (list, phaseId, fn) => ({
  ...list,
  phases: list.phases.map((p) => (p.id === phaseId ? fn(p) : p)),
});

function moveInArray(items, index, delta) {
  const to = index + delta;
  if (index < 0 || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

export function addTask(list, phaseId, task = {}) {
  const l = normalizeChecklist(list);
  if (!l.phases.some((p) => p.id === phaseId)) return l;
  return mapPhase(l, phaseId, (p) => ({ ...p, tasks: [...p.tasks, normalizeTask({ ...task, id: task.id || makeId('t') })] }));
}

// Editing the wording leaves the id alone, so a task keeps its tick through a
// rewrite — which is the whole point of keying ticks by id and not by text.
export function updateTask(list, phaseId, taskId, patch) {
  const l = normalizeChecklist(list);
  return mapPhase(l, phaseId, (p) => ({
    ...p,
    tasks: p.tasks.map((t) => (t.id === taskId ? normalizeTask({ ...t, ...patch, id: t.id }) : t)),
  }));
}

export function removeTask(list, phaseId, taskId) {
  const l = normalizeChecklist(list);
  return normalizeChecklist(mapPhase(l, phaseId, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== taskId) })));
}

export function moveTask(list, phaseId, taskId, delta) {
  const l = normalizeChecklist(list);
  return mapPhase(l, phaseId, (p) => ({
    ...p,
    tasks: moveInArray(p.tasks, p.tasks.findIndex((t) => t.id === taskId), delta),
  }));
}

const mapTask = (list, phaseId, taskId, fn) => mapPhase(list, phaseId, (p) => ({
  ...p,
  tasks: p.tasks.map((t) => (t.id === taskId ? fn(t) : t)),
}));

/* A new step is new work, so it reopens a finished task — with the steps that
   were already there kept ticked, the same way unticking one step does. */
export function addStep(list, phaseId, taskId, step = {}) {
  const l = normalizeChecklist(list);
  const tKey = taskKey(phaseId, taskId);
  const task = findTask(l.phases, tKey);
  if (!task) return l;
  const done = { ...l.done };
  if (done[tKey]) {
    delete done[tKey];
    task.steps.forEach((s) => { done[stepKey(phaseId, taskId, s.id)] = true; });
  }
  const added = normalizeStep({ ...step, id: step.id || makeId('s') });
  return mapTask({ ...l, done }, phaseId, taskId, (t) => ({ ...t, steps: [...t.steps, added] }));
}

export function updateStep(list, phaseId, taskId, stepId, patch) {
  const l = normalizeChecklist(list);
  return mapTask(l, phaseId, taskId, (t) => ({
    ...t,
    steps: t.steps.map((s) => (s.id === stepId ? normalizeStep({ ...s, ...patch, id: s.id }) : s)),
  }));
}

// Removing the last open step leaves every remaining one ticked, which
// finishes the task.
export function removeStep(list, phaseId, taskId, stepId) {
  const l = normalizeChecklist(list);
  const next = normalizeChecklist(mapTask(l, phaseId, taskId, (t) => ({ ...t, steps: t.steps.filter((s) => s.id !== stepId) })));
  const tKey = taskKey(phaseId, taskId);
  const task = findTask(next.phases, tKey);
  if (task && task.steps.length && !next.done[tKey] && task.steps.every((s) => next.done[stepKey(phaseId, taskId, s.id)])) {
    task.steps.forEach((s) => { delete next.done[stepKey(phaseId, taskId, s.id)]; });
    next.done[tKey] = true;
  }
  return next;
}

export function addPhase(list, phase = {}) {
  const l = normalizeChecklist(list);
  return { ...l, phases: [...l.phases, normalizePhase({ ...phase, id: phase.id || makeId('p') })] };
}

export function updatePhase(list, phaseId, patch) {
  const l = normalizeChecklist(list);
  return mapPhase(l, phaseId, (p) => ({ ...normalizePhase({ ...p, ...patch, id: p.id }), tasks: p.tasks }));
}

export function removePhase(list, phaseId) {
  const l = normalizeChecklist(list);
  return normalizeChecklist({ ...l, phases: l.phases.filter((p) => p.id !== phaseId) });
}

export function movePhase(list, phaseId, delta) {
  const l = normalizeChecklist(list);
  return { ...l, phases: moveInArray(l.phases, l.phases.findIndex((p) => p.id === phaseId), delta) };
}

/* Put the built-in list back, keeping whatever ticks still land on a task.

   Once the list is editable the original is otherwise unreachable, and a
   half-deleted checklist with no way back would be a trap. */
export function restoreSeed(list) {
  return normalizeChecklist({ phases: SEED_PHASES, done: normalizeChecklist(list).done, seedVersion: SEED_VERSION });
}
