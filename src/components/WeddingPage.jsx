import { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE } from '../native';
import { WeddingChecklist } from './WeddingChecklist';
import { WeddingTimeline } from './WeddingTimeline';
import { WeddingVenues } from './WeddingVenues';
import { WeddingFriendsNotInvited } from './WeddingFriendsNotInvited';
import { FriendsPage } from './FriendsPage';
import { WeddingPartyCell } from './WeddingPartyCell';
import { makeGuestComparator, sameSortValue, statusOrder } from '../lib/weddingSort';
import { partyKey, partnerMap, partyUnits, moveUnit, orderFromUnits, partyPositions, guestName, keepCouplesTogether, rowOutlines, groupPartiesTogether, partnersFollowGroup } from '../lib/weddingParty';
import { guestFromFriend } from '../lib/weddingFriendMatch';
import { addFriend } from '../lib/friends';
import { findFriendForGuest, friendDataFromGuest } from '../lib/weddingGuestFriend';
import { syncWeddingGuestsToFriends, SYNC_FLAG } from '../lib/weddingFriendSync';
import { buildGuestWorkbook, exportFileName } from '../lib/weddingGuestExport';
import { WeddingExportMenu } from './WeddingExportMenu';
import { IMPORT_FIELDS, FIELD_LABELS, parsePastedCells, autoDetectMappings, looksLikeHeader, planGuestImport } from '../lib/weddingGuestImport';
import { applyGuestMerge, findGuestDuplicateGroups } from '../lib/weddingGuestMerge';
import { commitFriendMerge } from '../lib/friendMergeWrite';
import { GuestDuplicatesModal, GuestMergeModal } from './WeddingGuestMerge';
import { splitGuestName, withFriendNames } from '../lib/weddingGuestNames';
import styles from './WeddingPage.module.css';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SEED_CONTACTS = [
  { firstName: 'Skyler', lastName: 'Marinoff', address: '1661 Sacramento Street', city: 'San Francisco', state: 'CA', zip: '94109', phone: '(631) 418-6458', email: 'Skyler.marinoff@gmail.com' },
  { firstName: 'Brian', lastName: 'Mulligan', address: '47 Twin Oaks Drive', city: 'Kings Park', state: 'NY', zip: '11754', phone: '(631) 873-7978', email: 'Btmulligan91@gmail.com' },
  { firstName: 'Ally', lastName: 'Mulligan', address: '47 Twin Oaks Drive', city: 'Kings Park', state: 'NY', zip: '11754', phone: '(631) 512-0794', email: '' },
  { firstName: 'Cody', lastName: 'Vassallo', address: '10 Ever Green Drive', city: 'Manorville', state: 'NY', zip: '11949', phone: '(631) 759-6808', email: '' },
  { firstName: 'Alexa', lastName: 'Vassallo', address: '10 Ever Green Drive', city: 'Manorville', state: 'NY', zip: '11949', phone: '(631) 416-6825', email: '' },
  { firstName: 'Ava', lastName: 'Martensen', address: '7 Orient Ave', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 375-5424', email: '' },
  { firstName: 'Hank', lastName: 'Martensen', address: '7 Orient Ave', city: 'Northport', state: 'NY', zip: '11768', phone: '(516) 384-5172', email: '' },
  { firstName: 'Ken', lastName: 'Going', address: '118E Driver Lane', city: 'South Kingstown', state: 'RI', zip: '02879', phone: '(516) 480-0037', email: '' },
  { firstName: 'Christine', lastName: 'Going', address: '118E Driver Lane', city: 'South Kingstown', state: 'RI', zip: '02879', phone: '(631) 662-0894', email: '' },
  { firstName: 'Loring', lastName: 'Andersen', address: '25 Crescent Beach Drive', city: 'Huntington', state: 'NY', zip: '11743', phone: '(516) 443-2995', email: '' },
  { firstName: 'Wendy', lastName: 'Andersen', address: '25 Crescent Beach Drive', city: 'Huntington', state: 'NY', zip: '11743', phone: '(516) 982-2247', email: '' },
  { firstName: 'Doug', lastName: 'Munch', address: '9 Oakmere Drive', city: 'Fort Salonga', state: 'NY', zip: '11768', phone: '(631) 697-7679', email: '' },
  { firstName: 'Marion', lastName: 'Munch', address: '9 Oakmere Drive', city: 'Fort Salonga', state: 'NY', zip: '11768', phone: '(631) 680-1964', email: '' },
  { firstName: 'John', lastName: 'Froeb', address: '10412 William Penn Lane', city: 'Charlotte', state: 'NC', zip: '28277', phone: '(704) 650-5873', email: '' },
  { firstName: 'Kim', lastName: 'Froeb', address: '10412 William Penn Lane', city: 'Charlotte', state: 'NC', zip: '28277', phone: '(704) 650-3694', email: '' },
  { firstName: 'William', lastName: 'Papillon', address: '5148 15th Ave. South', city: 'Minneapolis', state: 'MN', zip: '55417', phone: '(617) 487-9015', email: '' },
  { firstName: 'Susi', lastName: 'Papillon', address: '7 rue Henri Arhex', city: 'Lacanau', state: 'France', zip: '33680', phone: '+33 (3362) 011-3043', email: '' },
  { firstName: 'Larry', lastName: 'Bellomo', address: '10 Norwood Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(516) 480-6908', email: '' },
  { firstName: 'Janice', lastName: 'Bellomo', address: '10 Norwood Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 988-3444', email: '' },
  { firstName: 'Chuck', lastName: 'Schlapp', address: '124 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 721-3963', email: '' },
  { firstName: 'Mary', lastName: 'Schlapp', address: '124 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 721-3964', email: '' },
  { firstName: 'Bill', lastName: "O'Neill", address: '31 Norwood Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 478-2643', email: '' },
  { firstName: 'Laurie', lastName: "O'Neill", address: '31 Norwood Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 327-6151', email: '' },
  { firstName: 'Judy', lastName: 'Baron', address: '40 Goldenrod Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(516) 445-4438', email: '' },
  { firstName: 'Bruce', lastName: 'Baron', address: '40 Goldenrod Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 921-4057', email: '' },
  { firstName: 'Aline', lastName: 'Szenczy', address: '112 Eagle Street', city: 'Brooklyn', state: 'NY', zip: '11222', phone: '(631) 455-4716', email: 'aline.szenczy@stonybrook.edu' },
  { firstName: 'Sebastian', lastName: 'Wernecke', address: '112 Eagle Street', city: 'Brooklyn', state: 'NY', zip: '11222', phone: '(704) 244-3316', email: 'sebastian.j.w@live.com' },
  { firstName: 'Ryan', lastName: 'Mullins', address: '1326 Monroe Avenue', city: 'Wyomissing', state: 'PA', zip: '19610', phone: '(908) 432-0563', email: 'ryan.s.mullins@gmail.com' },
  { firstName: 'Caitlin', lastName: 'Mullins', address: '1326 Monroe Avenue', city: 'Wyomissing', state: 'PA', zip: '19610', phone: '(484) 332-4911', email: '' },
  { firstName: 'Lauren', lastName: 'Wetzel', address: '1334 Pulaski Road', city: 'East Northport', state: 'NY', zip: '11731', phone: '(631) 357-2082', email: '' },
  { firstName: 'Zach', lastName: 'Wetzel', address: '1334 Pulaski Road', city: 'East Northport', state: 'NY', zip: '11731', phone: '(516) 459-0948', email: '' },
  { firstName: 'Katie', lastName: 'Anderson', address: '146 Meserole Street', city: 'Brooklyn', state: 'NY', zip: '11206', phone: '', email: '' },
  { firstName: 'Will', lastName: 'Pratt-Stephen', address: '146 Meserole Street', city: 'Brooklyn', state: 'NY', zip: '11206', phone: '(631) 835-0114', email: '' },
  { firstName: 'Amanda', lastName: 'Smith', address: '19 Hudson Drive', city: 'Kings Park', state: 'NY', zip: '11754', phone: '(631) 740-7387', email: '' },
  { firstName: 'Kenny', lastName: 'Smith', address: '19 Hudson Drive', city: 'Kings Park', state: 'NY', zip: '11754', phone: '(631) 327-9579', email: '' },
  { firstName: 'Kaleigh', lastName: 'Bernier', address: '27 Harding Street', city: 'East Northport', state: 'NY', zip: '11731', phone: '(508) 713-1670', email: '' },
  { firstName: 'Nick', lastName: 'Graci', address: '27 Harding Street', city: 'East Northport', state: 'NY', zip: '11731', phone: '(631) 747-3476', email: '' },
  { firstName: 'Shannen', lastName: 'Bagley', address: '299 Graham Avenue', city: 'Brooklyn', state: 'NY', zip: '11211', phone: '(732) 864-5134', email: '' },
  { firstName: 'Duncan', lastName: 'Pratt-Stephen', address: '299 Graham Avenue', city: 'Brooklyn', state: 'NY', zip: '11211', phone: '(516) 527-9595', email: 'Duncann18@gmail.com' },
  { firstName: 'Madison', lastName: 'Miller', address: '304 Jackson Blvd', city: 'Wilmington', state: 'DE', zip: '19803', phone: '', email: '' },
  { firstName: 'Jordan', lastName: 'Miller', address: '304 Jackson Blvd', city: 'Wilmington', state: 'DE', zip: '19803', phone: '(302) 562-7719', email: 'jordan.miller.81390@gmail.com' },
  { firstName: 'Kate', lastName: 'Boucher', address: '43 Sea Cove Road', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 921-3565', email: 'ksoskil@gmail.com' },
  { firstName: 'Harry', lastName: 'Boucher', address: '43 Sea Cove Road', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 747-2947', email: 'hpoulos1@gmail.com' },
  { firstName: 'Adam', lastName: 'Herzog', address: '212 Montrose Ave', city: 'Brooklyn', state: 'NY', zip: '11206', phone: '(631) 278-5892', email: 'Zogg25@gmail.com' },
  { firstName: 'Kyle', lastName: 'Smith', address: '97 Scudder Place', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 375-1366', email: 'kyle.t.smith09@gmail.com' },
  { firstName: 'Leah', lastName: 'Smith', address: '97 Scudder Place', city: 'Northport', state: 'NY', zip: '11768', phone: '(410) 240-6903', email: '' },
  { firstName: 'Laura', lastName: 'Sova', address: '100 W 92nd Street', city: 'New York', state: 'NY', zip: '10025', phone: '(516) 269-1180', email: 'laura.montague33@gmail.com' },
  { firstName: 'Milan', lastName: 'Sova', address: '100 W 92nd Street', city: 'New York', state: 'NY', zip: '10025', phone: '(607) 437-5122', email: 'msova@law.fordham.edu' },
  { firstName: 'Dan', lastName: 'Baldauf', address: '107 N 8th Street', city: 'Brooklyn', state: 'NY', zip: '11249', phone: '(631) 988-9244', email: 'baldaufdan@gmail.com' },
  { firstName: 'Joanne', lastName: 'Seo', address: '107 N 8th Street', city: 'Brooklyn', state: 'NY', zip: '11249', phone: '(631) 988-9244', email: '' },
  { firstName: 'Jack', lastName: 'Montague', address: '13297 Glencliff Way', city: 'San Diego', state: 'CA', zip: '92130', phone: '(516) 456-4640', email: 'john.montague.iv@gmail.com' },
  { firstName: 'Kelle', lastName: 'Montague', address: '13297 Glencliff Way', city: 'San Diego', state: 'CA', zip: '92130', phone: '(858) 337-9151', email: '' },
  { firstName: 'Christina', lastName: 'Siraco', address: '14 Valleywood Rd', city: 'Commack', state: 'NY', zip: '11725', phone: '(631) 745-7415', email: '' },
  { firstName: 'John', lastName: 'Siraco', address: '14 Valleywood Rd', city: 'Commack', state: 'NY', zip: '11725', phone: '(516) 749-2319', email: '' },
  { firstName: 'Sally', lastName: 'Baldauf', address: '147 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 839-1864', email: 'sbaldauf@hotmail.com' },
  { firstName: 'Brian', lastName: 'Baldauf', address: '147 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 897-4517', email: 'Brian@kismetcruising.com' },
  { firstName: 'Russell', lastName: 'Wildermuth', address: '1653 Dewey Avenue', city: 'North Bellmore', state: 'NY', zip: '11710', phone: '(516) 262-0168', email: '' },
  { firstName: 'Lauren', lastName: 'Wildermuth', address: '1653 Dewey Avenue', city: 'North Bellmore', state: 'NY', zip: '11710', phone: '', email: '' },
  { firstName: 'Celia', lastName: 'Delsandro', address: '172 Woodbine Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(516) 429-5899', email: '' },
  { firstName: 'Johnny', lastName: 'Delsandro', address: '172 Woodbine Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 897-6185', email: 'John.delsandro@gmail.com' },
  { firstName: 'Grace', lastName: 'Ringen', address: '172 Woodbine Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 944-1034', email: 'graceringen@gmail.com' },
  { firstName: 'Mike', lastName: 'Baldauf', address: '187 Fox Lane', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 988-2875', email: '' },
  { firstName: 'Betty', lastName: 'Finken', address: '19 Overhill Drive', city: 'Trophy Club', state: 'TX', zip: '76262', phone: '(617) 899-4126', email: '' },
  { firstName: 'Amanda', lastName: 'Brehove', address: '205 Hudson Street', city: 'Hoboken', state: 'NJ', zip: '07030', phone: '(631) 988-9129', email: 'amanda.brehove@gmail.com' },
  { firstName: 'Jordan', lastName: 'Brehove', address: '205 Hudson Street', city: 'Hoboken', state: 'NJ', zip: '07030', phone: '(973) 713-0336', email: 'jbrehove@gmail.com' },
  { firstName: 'Kerry', lastName: 'Lupton', address: '207 Canterwood Lane', city: 'New Bern', state: 'NC', zip: '28562', phone: '', email: '' },
  { firstName: 'Cathy', lastName: 'Montague', address: '207 Canterwood Lane', city: 'New Bern', state: 'NC', zip: '28562', phone: '(516) 457-7543', email: '' },
  { firstName: 'Bob', lastName: 'Wildermuth', address: '22 Pearwood Drive', city: 'Huntington Station', state: 'NY', zip: '11746', phone: '(917) 468-3299', email: '' },
  { firstName: 'Allison', lastName: 'Wildermuth', address: '22 Pearwood Drive', city: 'Huntington Station', state: 'NY', zip: '11746', phone: '(516) 429-5340', email: '' },
  { firstName: 'Grace', lastName: 'Wildermuth', address: '22 Pearwood Drive', city: 'Huntington Station', state: 'NY', zip: '11746', phone: '(631) 944-5442', email: '' },
  { firstName: 'Jack', lastName: 'Finken', address: '2990 Blackburn St', city: 'Dallas', state: 'TX', zip: '75204', phone: '(781) 812-4804', email: '' },
  { firstName: 'Steve', lastName: 'Baldauf', address: '3326 Bluffview Drive', city: 'Garland', state: 'TX', zip: '75043-1409', phone: '(214) 794-2092', email: '' },
  { firstName: 'Judy', lastName: 'Baldauf', address: '3326 Bluffview Drive', city: 'Garland', state: 'TX', zip: '75043-1409', phone: '(214) 334-2712', email: '' },
  { firstName: 'Nicole', lastName: 'Huizenga', address: '4 Sunrise Court', city: 'Trophy Club', state: 'TX', zip: '76262', phone: '(781) 812-4803', email: '' },
  { firstName: 'Nils', lastName: 'Huizenga', address: '4 Sunrise Court', city: 'Trophy Club', state: 'TX', zip: '76262', phone: '(940) 395-0063', email: '' },
  { firstName: 'Adam', lastName: 'Baldauf', address: '53 Shattuck Street', city: 'Pepperell', state: 'MA', zip: '01463', phone: '(979) 220-0611', email: '' },
  { firstName: 'Jenn', lastName: 'Baldauf', address: '53 Shattuck Street', city: 'Pepperell', state: 'MA', zip: '01463', phone: '(979) 220-8189', email: '' },
  { firstName: 'Matthew', lastName: 'Wildermuth', address: '6105 Spirit Street', city: 'Pittsburgh', state: 'PA', zip: '15206', phone: '(631) 327-0625', email: '' },
  { firstName: 'Katie', lastName: 'Baldauf', address: '89 Prospect Road', city: 'Centerport', state: 'NY', zip: '11721', phone: '(631) 988-8826', email: 'kaitlin.baldauf@gmail.com' },
  { firstName: 'Eric', lastName: 'Hebel', address: '89 Prospect Road', city: 'Centerport', state: 'NY', zip: '11721', phone: '(215) 588-7034', email: 'erichebel3@gmail.com' },
  { firstName: 'Nancy', lastName: 'Wildermuth', address: 'One Jefferson Avenue', city: 'Rockville Centre', state: 'NY', zip: '11570', phone: '(516) 456-5145', email: '' },
  { firstName: 'David', lastName: 'Wolfsohn', address: 'One Jefferson Avenue', city: 'Rockville Centre', state: 'NY', zip: '11570', phone: '', email: '' },
  { firstName: 'Kimberly', lastName: 'Yunker', address: 'One Jefferson Avenue', city: 'Rockville Centre', state: 'NY', zip: '11570', phone: '(516) 457-4849', email: '' },
  { firstName: 'Steve', lastName: 'Littman', address: '173 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(917) 991-1730', email: '' },
  { firstName: 'Sharon', lastName: 'Littman', address: '173 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(917) 991-9522', email: '' },
  { firstName: 'Sunnie', lastName: 'Martensen', address: '187 Fox Lane', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 697-4457', email: '' },
  { firstName: 'Susan', lastName: 'Ehrlich', address: '3890 Barbara Court', city: 'Seaford', state: 'NY', zip: '11783', phone: '(516) 220-5821', email: '' },
  { firstName: 'Dave', lastName: 'Ehrlich', address: '3890 Barbara Court', city: 'Seaford', state: 'NY', zip: '11783', phone: '', email: '' },
  { firstName: 'Greg', lastName: 'Buron', address: '4 Ivory Court', city: 'East Northport', state: 'NY', zip: '11731', phone: '(631) 664-7503', email: '' },
  { firstName: 'Julia', lastName: 'Ratner', address: '703 Densfield Road', city: 'West Babylon', state: 'NY', zip: '11704', phone: '', email: '' },
  { firstName: 'Brendan', lastName: 'Ratner', address: '703 Densfield Road', city: 'West Babylon', state: 'NY', zip: '11704', phone: '(631) 220-5974', email: '' },
  { firstName: 'Eric', lastName: 'Wildermuth', address: '328 Sunny Lane', city: 'Franklin Square', state: 'NY', zip: '11010', phone: '(516) 524-1444', email: '' },
  { firstName: 'Kathy', lastName: 'Wildermuth', address: '328 Sunny Lane', city: 'Franklin Square', state: 'NY', zip: '11010', phone: '', email: '' },
  { firstName: 'Karen', lastName: 'Bruckner', address: '68 Burtis Avenue', city: 'Oyster Bay', state: 'NY', zip: '11771', phone: '(516) 592-1468', email: '' },
  { firstName: 'Alex', lastName: 'Edwards-Bourdrez', address: '139 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 327-3301', email: '' },
  { firstName: 'Susan', lastName: 'Edwards-Bourdrez', address: '139 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(516) 994-0243', email: '' },
  { firstName: 'Billy', lastName: 'Smith', address: '235 Holden Avenue', city: 'Cutchogue', state: 'NY', zip: '11935', phone: '(516) 680-1852', email: '' },
  { firstName: 'Jamie', lastName: 'Caples', address: '235 Holden Avenue', city: 'Cutchogue', state: 'NY', zip: '11935', phone: '', email: '' },
  { firstName: 'Kevin', lastName: 'Nugent', address: '49 Union Avenue', city: 'Amityville', state: 'NY', zip: '11701', phone: '(347) 675-8876', email: '' },
  { firstName: 'Claire', lastName: 'Nugent', address: '49 Union Avenue', city: 'Amityville', state: 'NY', zip: '11701', phone: '(516) 263-7029', email: '' },
  { firstName: 'John', lastName: 'Sherman', address: '50 Montclair Drive', city: 'West Hartford', state: 'CT', zip: '06107', phone: '(860) 729-7598', email: '' },
  { firstName: 'Alice', lastName: 'Sherman', address: '50 Montclair Drive', city: 'West Hartford', state: 'CT', zip: '06107', phone: '(860) 989-4341', email: '' },
  { firstName: 'Michael', lastName: "O'Brien", address: '550 Richard Drive', city: 'Cheshire', state: 'CT', zip: '06410', phone: '(860) 817-6448', email: '' },
  { firstName: 'Ann', lastName: "O'Brien", address: '550 Richard Drive', city: 'Cheshire', state: 'CT', zip: '06410', phone: '', email: '' },
  { firstName: 'Peter', lastName: "O'Neill", address: '62 Carmen Place', city: 'Amityville', state: 'NY', zip: '11701', phone: '(516) 319-0199', email: '' },
  { firstName: 'Jeanie', lastName: "O'Neill", address: '62 Carmen Place', city: 'Amityville', state: 'NY', zip: '11701', phone: '', email: '' },
  { firstName: 'Mary', lastName: 'Carey', address: '11722 Currie Lane', city: 'Largo', state: 'FL', zip: '33774', phone: '(631) 834-5860', email: '' },
  { firstName: 'Kenny', lastName: 'Kuska', address: '528 Azalea Lane', city: 'Bridgeville', state: 'PA', zip: '15017', phone: '(412) 414-5492', email: '' },
  { firstName: 'Sandy', lastName: 'Kuska', address: '528 Azalea Lane', city: 'Bridgeville', state: 'PA', zip: '15017', phone: '', email: '' },
  { firstName: 'Ben', lastName: 'Haffner', address: '117 W 17th Street', city: 'New York', state: 'NY', zip: '10011', phone: '(631) 897-2287', email: '' },
  { firstName: 'Venice', lastName: 'Haffner', address: '117 W 17th Street', city: 'New York', state: 'NY', zip: '10011', phone: '', email: '' },
  { firstName: 'Brian', lastName: 'Donovan', address: '112 Frisbee Hill Road', city: 'Hilton', state: 'NY', zip: '14468', phone: '(585) 313-1940', email: '' },
  { firstName: 'Susie', lastName: 'Collins', address: '3109 Blair Circle', city: 'Virginia Beach', state: 'VA', zip: '23452', phone: '(757) 343-7199', email: '' },
  { firstName: 'Howard', lastName: 'Collins', address: '3109 Blair Circle', city: 'Virginia Beach', state: 'VA', zip: '23452', phone: '', email: '' },
  { firstName: 'Nancy', lastName: 'Wildermuth', address: '4951 Julie Court', city: 'Doylestown', state: 'PA', zip: '18901', phone: '(215) 260-5286', email: '' },
  { firstName: 'Paul', lastName: 'Wildermuth', address: '4951 Julie Court', city: 'Doylestown', state: 'PA', zip: '18901', phone: '(215) 341-6221', email: '' },
  { firstName: 'Patrick', lastName: 'Dunleavy', address: '5240 Tennyson Street', city: 'Denver', state: 'CO', zip: '80212', phone: '(720) 276-3766', email: '' },
  { firstName: 'Donna', lastName: 'Rich', address: '68 Hawley Drive', city: 'Enfield', state: 'NH', zip: '03748', phone: '(978) 618-0420', email: '' },
  { firstName: 'Brad', lastName: 'Rich', address: '68 Hawley Drive', city: 'Enfield', state: 'NH', zip: '03748', phone: '', email: '' },
  { firstName: 'Lynn', lastName: 'Seim', address: '71 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(347) 738-3444', email: '' },
  { firstName: 'Russ', lastName: 'Seim', address: '71 Highland Avenue', city: 'Northport', state: 'NY', zip: '11768', phone: '(631) 745-8365', email: '' },
  { firstName: 'Bruce', lastName: 'Wildermuth', address: '72 Accabonac Road', city: 'East Hampton', state: 'NY', zip: '11937', phone: '(516) 457-7080', email: '' },
  { firstName: 'JoAnn', lastName: 'Wildermuth', address: '72 Accabonac Road', city: 'East Hampton', state: 'NY', zip: '11937', phone: '', email: '' },
];

// RSVP status. Rows sink by status: undecided and Pending stay on top where the
// work is, Confirmed drops below them, and Not coming sits at the very bottom.
const STATUS_OPTIONS = ['Pending', 'Confirmed', 'Not coming'];
const STATUS_CLASS = { Pending: 'statusPending', Confirmed: 'statusConfirmed', 'Not coming': 'statusDeclined' };

// sortBy gives each column's sort value; lib/weddingSort.js does the comparing
// (blanks last, natural order, ties by name).
const ALL_COLUMNS = [
  { key: 'name', label: 'Name', defaultWidth: 180, sortBy: (c) => [c.lastName, c.firstName] },
  { key: 'status', label: 'Status', defaultWidth: 130, sortBy: statusOrder },
  { key: 'group', label: 'Group', defaultWidth: 140, sortBy: (c) => (c.group || '').toLowerCase() },
  { key: 'category', label: 'Category', defaultWidth: 140, sortBy: (c) => (c.category || '').toLowerCase() },
  // Sorts inside its category, so the same subcategory name under two
  // categories doesn't interleave them.
  { key: 'subcategory', label: 'Subcategory', defaultWidth: 150, sortBy: (c) => (c.subcategory ? [c.category, c.subcategory] : '') },
  { key: 'guestOf', label: 'Guest Of', defaultWidth: 140, sortBy: (c) => (c.guestOf || '').toLowerCase() },
  // Side of the family — free-form ("Mom's side", "Baldauf side"), its own list.
  { key: 'side', label: 'Side', defaultWidth: 150, sortBy: (c) => (c.side || '').toLowerCase() },
  // Household / party (lib/weddingParty.js). Sorted by the table itself, not
  // here: members sit together in their saved order, couples side by side.
  { key: 'party', label: 'Wedding group', defaultWidth: 170, sortBy: (c) => partyKey(c.party) || '￿' },
  { key: 'friend', label: 'Friend', defaultWidth: 180, sortBy: (c) => c.friendId || '' },
  { key: 'email', label: 'Email', defaultWidth: 220, sortBy: (c) => (c.email || '').toLowerCase() },
  { key: 'phone', label: 'Phone', defaultWidth: 140, sortBy: (c) => c.phone || '' },
  { key: 'address', label: 'Address', defaultWidth: 220, sortBy: (c) => (c.address || '').toLowerCase() },
  { key: 'city', label: 'City', defaultWidth: 140, sortBy: (c) => (c.city || '').toLowerCase() },
  { key: 'state', label: 'State', defaultWidth: 80, sortBy: (c) => (c.state || '').toLowerCase() },
  { key: 'zip', label: 'Zip', defaultWidth: 90, sortBy: (c) => c.zip || '' },
];

const DEFAULT_VISIBLE = ['name', 'status', 'group', 'category', 'subcategory', 'guestOf', 'side', 'party', 'friend', 'email', 'phone', 'city', 'state'];

const EDITABLE_FIELDS = [
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'status', label: 'Status' },
  { key: 'group', label: 'Group' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'guestOf', label: 'Guest Of' },
  { key: 'side', label: 'Side of the family' },
  { key: 'party', label: 'Wedding group' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'Zip' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
];

// What the contact pop-up edits, in the order it shows them.
const CONTACT_FORM_FIELDS = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'address', label: 'Address', wide: true },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'Zip' },
  { key: 'guestOf', label: 'Guest of' },
  { key: 'side', label: 'Side of the family' },
  { key: 'status', label: 'Status' },
  { key: 'group', label: 'Group' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'party', label: 'Wedding group', wide: true },
];

// What the Friends pop-up doesn't already hold: the mailing address split the
// way invitations need it, and the wedding's own fields. Name, email and phone
// come from the contact itself.
const WEDDING_ONLY_FIELDS = CONTACT_FORM_FIELDS.filter((f) => !['firstName', 'lastName', 'phone', 'email'].includes(f.key))
  .map((f) => (f.key === 'address' ? { ...f, label: 'Mailing address' } : f));

// A guest whose category is "Hide" drops out of the page: the table, every
// count and summary, the other subtabs and the weekly email. They stay on the
// list (and in their own Hide tab) so they can be brought back by changing the
// category. Same rule as isHiddenGuest in lib/weddingStats.js.
const HIDE_CATEGORY = 'hide';
const isHidden = (c) => String(c?.category || '').trim().toLowerCase() === HIDE_CATEGORY;

// The table's outline colours until you pick your own — the same as the
// --wd-group / --wd-couple defaults in WeddingPage.module.css.
const DEFAULT_OUTLINE_COLORS = { group: '#4f46e5', couple: '#e11d74' };
const isHexColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

const NEW_GROUP_SENTINEL = '__new_group__';
const NEW_SIDE_SENTINEL = '__new_side__';
const NEW_CATEGORY_SENTINEL = '__new_category__';
const NEW_SUBCATEGORY_SENTINEL = '__new_subcategory__';

/* Where the guest list opens: the All tab, which is every guest on the list
   (bar the hidden ones). The guests with no category yet have their own
   "Not categorized" tab — the pile still to sort. "Clear filters" comes back
   to All too. */
const DEFAULT_FILTERS = {};
const UNSORTED = '__none__';
const SEED_FLAG_KEY = 'rally.weddingContacts.seeded';
const GUEST_OF_OPTIONS = ['Dan', 'Joanne'];

// What the A/B/C tiers mean until you say otherwise. A group's description
// shows in the legend and as a hover tooltip; once edited (or carried over by
// a rename) the saved one in weddingGroupDescriptions wins.
const TIER_DESCRIPTIONS = {
  A: 'Must-invite no matter the venue size',
  B: 'Really want them there if space and budget allow',
  C: 'Would be nice — invite if others decline (your "B-list" for second-round invites)',
};

// "Added 120 guests to Friends and linked 30 who were already there."
function friendSyncSummary(created, linked) {
  const existing = linked - created;
  const plural = (n) => (n === 1 ? 'guest' : 'guests');
  const parts = [];
  if (created) parts.push(`added ${created} ${plural(created)} to Friends`);
  if (existing > 0) parts.push(`linked ${existing} ${existing === 1 ? 'who was' : 'who were'} already there`);
  const s = parts.join(' and ');
  return s ? `${s[0].toUpperCase()}${s.slice(1)}.` : '';
}

function renderCell(col, c) {
  switch (col.key) {
    case 'name': return <>{c.firstName} {c.lastName}</>;
    case 'group': return c.group ? <span className={styles.groupBadge}>{c.group}</span> : <span className={styles.muted}>—</span>;
    case 'guestOf': return c.guestOf || <span className={styles.muted}>—</span>;
    case 'side': return c.side || <span className={styles.muted}>—</span>;
    case 'party': return c.party ? <span className={styles.partyBadge}>{c.party}</span> : <span className={styles.muted}>—</span>;
    case 'email': return c.email ? <a className={styles.link} href={`mailto:${c.email}`}>{c.email}</a> : <span className={styles.muted}>—</span>;
    case 'phone': return c.phone ? <a className={styles.link} href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a> : <span className={styles.muted}>—</span>;
    case 'address': return c.address || <span className={styles.muted}>—</span>;
    case 'city': return c.city || <span className={styles.muted}>—</span>;
    case 'state': return c.state || <span className={styles.muted}>—</span>;
    case 'zip': return c.zip || <span className={styles.muted}>—</span>;
    default: return null;
  }
}

/* The guest list — the original Wedding page, now one of two subtabs.

   Left whole rather than split up: it owns a lot of interlocking state
   (filters, selection, bulk edit, the import dialog) and none of it is
   shared with the checklist beside it. */
function GuestList() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [friends, setFriends] = useState([]);
  // Whether the guest list has had its one pass onto the Friends page
  // (lib/weddingFriendSync.js). null until the user doc has loaded.
  const [friendsSynced, setFriendsSynced] = useState(null);
  const friendSyncStarted = useRef(false);
  const [friendSyncMsg, setFriendSyncMsg] = useState('');
  // Merging duplicates: the guests on the merge screen, whether the suggested
  // duplicates list is open, and the line saying what the last merge did.
  const [mergingGuests, setMergingGuests] = useState(null);
  const [showGuestDuplicates, setShowGuestDuplicates] = useState(false);
  const [mergeMsg, setMergeMsg] = useState('');
  const [exporting, setExporting] = useState(false);
  const [savedGroups, setSavedGroups] = useState([]);
  const [savedSides, setSavedSides] = useState([]);
  const [groupDescriptions, setGroupDescriptions] = useState({});
  // The "Edit groups" pop-up: one row per group, { from, name, desc }.
  // Nothing is written until Save.
  const [groupEditor, setGroupEditor] = useState(null);
  const [savedCategories, setSavedCategories] = useState([]);
  // The "Edit categories" pop-up: one row per category, { from, name, count,
  // deleted }. Same shape and rules as the group editor; nothing is written
  // until Save.
  const [categoryEditor, setCategoryEditor] = useState(null);
  const [columnConfig, setColumnConfig] = useState({});
  // The table's outline colours ({ group, couple }, hex), saved on the user
  // doc as weddingOutlineColors. Blank means the default from the stylesheet.
  const [outlineColors, setOutlineColors] = useState({});
  const outlineSaveTimer = useRef(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState(DEFAULT_FILTERS);
  // '' is the default view (by name, status sunk); a header click sorts by
  // that column alone.
  const [sortKey, setSortKey] = useState('');
  /* Group view: each wedding group pulled into one block (couples beside each
     other) and outlined. Off is the plain table — sorted strictly by the
     column, no regrouping, no boxes. Saved on the user doc (weddingGroupView)
     so it's the same on the phone; on until switched off. */
  const [groupView, setGroupView] = useState(true);
  // Outline kinds switched off in the key ({ group, couple }: true = hidden),
  // saved as weddingOutlinesHidden. Hiding one only drops its boxes — group
  // view still keeps the rows together.
  const [hiddenOutlines, setHiddenOutlines] = useState({});
  const [sortDir, setSortDir] = useState('asc');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkField, setBulkField] = useState('group');
  const [bulkValue, setBulkValue] = useState('');
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // The contact open in the edit pop-up: { id, draft }. An existing guest's
  // draft saves itself a moment after each edit (and on close); a new guest
  // is only written by Add guest.
  const [editing, setEditing] = useState(null);
  const isEditing = !!editing;
  useEffect(() => {
    if (!isEditing) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeContactRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditing]);
  const groupEditorOpen = !!groupEditor;
  useEffect(() => {
    if (!groupEditorOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setGroupEditor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groupEditorOpen]);
  const categoryEditorOpen = !!categoryEditor;
  useEffect(() => {
    if (!categoryEditorOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setCategoryEditor(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [categoryEditorOpen]);
  const [importText, setImportText] = useState('');
  const [importHasHeader, setImportHasHeader] = useState(true);
  const [importMappings, setImportMappings] = useState([]);
  // Off: a guest already on the list only gets their empty fields filled.
  // On: the pasted values replace what's there (an empty cell still never
  // blanks anything out).
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importResultMsg, setImportResultMsg] = useState('');
  // Weekly guest-list email. null until the user doc arrives so the card can
  // stay quiet rather than flashing "off" at someone who has it on.
  const [digestCfg, setDigestCfg] = useState(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestMsg, setDigestMsg] = useState(null);
  const [partnerMsg, setPartnerMsg] = useState('');
  const seedAttempted = useRef(false);
  const columnsMenuRef = useRef(null);
  // Where the Columns list opens: whichever side of the button has room, and
  // no taller than the space left on screen (it scrolls past that).
  const [columnsMenuPos, setColumnsMenuPos] = useState(null);
  const columnConfigRef = useRef({});
  const dragRef = useRef(null);
  const resizedRef = useRef(false);

  useEffect(() => { columnConfigRef.current = columnConfig; }, [columnConfig]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setSavedGroups(Array.isArray(data.weddingGroups) ? data.weddingGroups : []);
        setSavedSides(Array.isArray(data.weddingSides) ? data.weddingSides : []);
        setGroupDescriptions(data.weddingGroupDescriptions && typeof data.weddingGroupDescriptions === 'object' ? data.weddingGroupDescriptions : {});
        setSavedCategories(Array.isArray(data.weddingCategories) ? data.weddingCategories : []);
        setFriendsSynced(!!data[SYNC_FLAG]);
        setColumnConfig(data.weddingColumnConfig && typeof data.weddingColumnConfig === 'object' ? data.weddingColumnConfig : {});
        // Not while a pick is still waiting to be saved, or the snapshot of the
        // previous save would snap the picker back mid-drag.
        if (!outlineSaveTimer.current) {
          setOutlineColors(data.weddingOutlineColors && typeof data.weddingOutlineColors === 'object' ? data.weddingOutlineColors : {});
        }
        setGroupView(data.weddingGroupView !== false);
        setHiddenOutlines(data.weddingOutlinesHidden && typeof data.weddingOutlinesHidden === 'object' ? data.weddingOutlinesHidden : {});
        // Defaults chosen so switching it on is a one-click decision: their own
        // address, Sunday morning, whatever timezone the browser is in.
        const wd = data.weddingDigest && typeof data.weddingDigest === 'object' ? data.weddingDigest : {};
        setDigestCfg({
          enabled: !!wd.enabled,
          // A list now: a wedding has two people planning it, and the one who
          // wants the “still missing an address” line is often not the one who
          // set this up. An older config holding a single `email` opens as a
          // one-item list, so it reads the same until you add to it.
          emails: (Array.isArray(wd.emails) && wd.emails.length
            ? wd.emails
            : [wd.email || data.email || user.email || '']).filter((v, i) => i === 0 || v),
          sendWeekday: typeof wd.sendWeekday === 'number' ? wd.sendWeekday : 0,
          timezone: wd.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
          lastResult: wd.lastResult && typeof wd.lastResult === 'object' ? wd.lastResult : null,
        });
        const stored = Array.isArray(data.weddingContacts) ? data.weddingContacts : null;
        setLoading(false);
        if (stored) {
          setContacts(stored);
          return;
        }
        if (
          !seedAttempted.current &&
          user.email === 'baldaufdan@gmail.com' &&
          !localStorage.getItem(SEED_FLAG_KEY)
        ) {
          seedAttempted.current = true;
          try {
            const seeded = SEED_CONTACTS.map((c, i) => ({ id: `seed-${String(i).padStart(3, '0')}`, ...c }));
            await setDoc(ref, { weddingContacts: seeded }, { merge: true });
            localStorage.setItem(SEED_FLAG_KEY, '1');
          } catch (err) {
            console.error('Failed to seed wedding contacts:', err);
            setContacts(SEED_CONTACTS.map((c, i) => ({ id: `seed-${String(i).padStart(3, '0')}`, ...c })));
          }
        } else {
          setContacts([]);
        }
      },
      (err) => {
        console.error('Wedding contacts snapshot error:', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [user]);

  /* Every guest goes on the Friends page too. The list that was here before
     that rule gets one pass the first time the page opens; guests added since
     are handled as they're added (addNewGuest, performImport). */
  useEffect(() => {
    if (!user || friendsSynced !== false || contacts.length === 0 || friendSyncStarted.current) return;
    friendSyncStarted.current = true;
    syncWeddingGuestsToFriends(user.uid, { markDone: true })
      .then(({ created, linked }) => {
        if (linked) setFriendSyncMsg(friendSyncSummary(created, linked));
      })
      .catch((err) => console.error('Wedding → Friends sync failed:', err));
  }, [user, friendsSynced, contacts.length]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      collection(db, 'users', user.uid, 'friends'),
      (snap) => setFriends(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Friends snapshot error:', err),
    );
    return unsub;
  }, [user]);

  /* The list is ~15 columns tall and the button can sit anywhere the toolbar
     wraps it — on a phone at the left edge, low on the screen, above the
     bottom tab bar. Open it on the side with room, bring the button up if
     there's barely any space below, and cap the height so every column can be
     scrolled to instead of running off the page. */
  useLayoutEffect(() => {
    if (!showColumnsMenu) return undefined;
    const place = () => {
      const btn = columnsMenuRef.current;
      if (!btn) return;
      const GAP = 12;
      const MENU_W = 200;
      // Leave room for the phone's bottom tab bar (and a margin on desktop).
      const BOTTOM = window.innerWidth < 768 ? 96 : GAP;
      let r = btn.getBoundingClientRect();
      // The whole list's height, so it can open without scrolling when the
      // screen has room for it once the button is brought up.
      const need = Math.min(btn.querySelector('[data-columns-menu]')?.scrollHeight || 280, window.innerHeight - BOTTOM - 140);
      if (window.innerHeight - r.bottom - BOTTOM < need && r.top > 120) {
        window.scrollBy({ top: r.top - 80 });
        r = btn.getBoundingClientRect();
      }
      const alignLeft = r.left + MENU_W <= window.innerWidth - GAP || r.right < MENU_W + GAP;
      setColumnsMenuPos({
        ...(alignLeft ? { left: 0, right: 'auto' } : { right: 0, left: 'auto' }),
        maxHeight: Math.max(180, window.innerHeight - r.bottom - BOTTOM - 4),
        maxWidth: window.innerWidth - 2 * GAP,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [showColumnsMenu]);

  useEffect(() => {
    if (!showColumnsMenu) return;
    const onClick = (e) => {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target)) {
        setShowColumnsMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showColumnsMenu]);

  // Every write of the guest list goes through here, so a Comes With partner
  // follows a guest into (or out of) a wedding group however it was changed —
  // the pop-up, the table cell, bulk edit. One not on the list yet is added.
  const persistContacts = async (next) => {
    if (!user) return;
    const { list, moved, added } = partnersFollowGroup(contactsRef.current, next, friendsById, {
      makeGuest: (f) => (f ? guestFromFriend(f, `friend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) : null),
    });
    await setDoc(doc(db, 'users', user.uid), { weddingContacts: list }, { merge: true });
    const parts = [];
    if (added.length) parts.push(`${added.join(', ')} added to the guest list with their partner`);
    if (moved.length) parts.push(`${moved.join(', ')} moved with their partner`);
    if (parts.length) setPartnerMsg(`💑 ${parts.join('; ')}.`);
  };

  /* Autosave for an existing guest. The guest-only pop-up saves its whole
     draft; the Friends pop-up (viaFriend) saves only the wedding box here —
     the contact fields are FriendsPage's, copied back by saveGuestFromFriend.
     Reads go through refs so a timer that fires later sees the latest list. */
  const guestSaveTimer = useRef(null);
  const editingRef = useRef(null);
  const contactsRef = useRef(contacts);
  const closeContactRef = useRef(null);
  useEffect(() => {
    editingRef.current = editing;
    contactsRef.current = contacts;
    closeContactRef.current = closeContact;
  });
  const saveGuestDraft = async (ed) => {
    if (!ed || ed.id === null) return;
    const list = contactsRef.current;
    const guest = list.find((c) => c.id === ed.id);
    if (!guest) return;
    const keys = ed.viaFriend ? WEDDING_ONLY_FIELDS.map((f) => f.key) : Object.keys(ed.draft);
    const patch = {};
    for (const k of keys) {
      const v = ed.draft[k];
      patch[k] = typeof v === 'string' ? v.trim() : v;
    }
    // No category, no subcategory.
    if ('category' in patch && !patch.category) patch.subcategory = '';
    const changed = Object.entries(patch).some(([k, v]) => (guest[k] ?? '') !== (v ?? ''));
    if (!changed) return;
    // A new wedding group starts them at the end of it.
    if ('party' in patch && partyKey(guest.party) !== partyKey(patch.party)) patch.partyOrder = null;
    await persistContacts(list.map((c) => (c.id === ed.id ? { ...c, ...patch } : c)));
  };
  useEffect(() => {
    if (!editing || editing.id === null) return undefined;
    clearTimeout(guestSaveTimer.current);
    guestSaveTimer.current = setTimeout(() => {
      guestSaveTimer.current = null;
      saveGuestDraft(editingRef.current).catch((err) => console.error('Guest autosave failed:', err));
    }, 700);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const closeContact = () => {
    clearTimeout(guestSaveTimer.current);
    guestSaveTimer.current = null;
    const ed = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (ed && ed.id !== null) saveGuestDraft(ed).catch((err) => console.error('Guest save failed:', err));
  };

  /* ── Weekly guest-list email ────────────────────────────────
     Settings live on the user doc; the cron in api/wedding-digest.js reads
     them. Merge-written field by field so turning the digest on never
     overwrites lastSentDate or the snapshot the "since last week" line needs. */
  const saveDigest = async (patch) => {
    if (!user || !digestCfg) return;
    const next = { ...digestCfg, ...patch };
    setDigestCfg(next);
    setDigestMsg(null);
    try {
      await setDoc(doc(db, 'users', user.uid), { weddingDigest: patch }, { merge: true });
    } catch (err) {
      setDigestMsg({ type: 'error', text: `Couldn’t save: ${err.message}` });
    }
  };

  /* The list of addresses, edited in place. Saving writes `email: ''` alongside
     it: the digest still reads that field for configs saved before the list
     existed, so leaving it set would resurrect an address you'd just removed. */
  const saveDigestEmails = (emails) => saveDigest({
    emails: emails.map((e) => e.trim()).filter(Boolean),
    email: '',
  });

  const setDigestEmail = (i, value) => setDigestCfg({
    ...digestCfg,
    emails: digestCfg.emails.map((e, j) => (j === i ? value : e)),
  });

  const sendDigestTest = async () => {
    if (!user || digestBusy) return;
    setDigestBusy(true);
    setDigestMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/wedding-digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDigestMsg({ type: 'error', text: data.error || `Send failed (${res.status})` });
      } else if (data.skipped) {
        setDigestMsg({ type: 'error', text: `Nothing sent — ${data.skipped}.` });
      } else if (data.reason) {
        // Email isn't wired up in this environment; say so rather than
        // reporting a success that never left the building.
        setDigestMsg({ type: 'error', text: data.reason });
      } else {
        setDigestMsg({ type: 'ok', text: `Sent to ${(data.sentTo || digestCfg.emails).join(', ')}.` });
      }
    } catch (err) {
      setDigestMsg({ type: 'error', text: err.message });
    } finally {
      setDigestBusy(false);
    }
  };

  const persistSides = async (next) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { weddingSides: next }, { merge: true });
  };

  // "+ New side…" in any dropdown: ask for the name, keep it, hand it back.
  const promptNewSide = () => {
    const name = (prompt('New side of the family? (e.g. "Mom\'s side")') || '').trim();
    if (!name) return '';
    const nextSaved = Array.from(new Set([...savedSides, name])).sort((a, b) => a.localeCompare(b));
    setSavedSides(nextSaved);
    persistSides(nextSaved);
    return name;
  };

  const persistGroups = async (next) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { weddingGroups: next }, { merge: true });
  };

  const persistCategories = async (next) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { weddingCategories: next }, { merge: true });
  };

  /* A colour picker fires on every step of a drag, so the pick shows at once
     and is written once it settles. A '' colour puts the default back. */
  const updateOutlineColors = (patch) => {
    const next = { ...outlineColors, ...patch };
    setOutlineColors(next);
    clearTimeout(outlineSaveTimer.current);
    outlineSaveTimer.current = setTimeout(() => {
      outlineSaveTimer.current = null;
      if (!user) return;
      setDoc(doc(db, 'users', user.uid), { weddingOutlineColors: next }, { merge: true })
        .catch((err) => console.error('Failed to save outline colours:', err));
    }, 400);
  };
  useEffect(() => () => clearTimeout(outlineSaveTimer.current), []);
  const toggleGroupView = async () => {
    const next = !groupView;
    setGroupView(next);
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { weddingGroupView: next }, { merge: true });
    } catch (err) {
      console.error('Failed to save group view:', err);
    }
  };

  const toggleOutline = async (key) => {
    const next = { ...hiddenOutlines, [key]: !hiddenOutlines[key] };
    setHiddenOutlines(next);
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { weddingOutlinesHidden: next }, { merge: true });
    } catch (err) {
      console.error('Failed to save outline visibility:', err);
    }
  };

  const persistColumnConfig = async (next) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { weddingColumnConfig: next }, { merge: true });
  };

  const friendsById = useMemo(() => {
    const m = new Map();
    friends.forEach((f) => m.set(f.id, f));
    return m;
  }, [friends]);

  /* A guest linked to a Friends contact goes by the contact's name, wherever
     it was changed — the Friends tab, a merge, or a link made by the Friend
     column or Auto-match. Shown at once and saved, so the export and the
     weekly email say the same. */
  useEffect(() => {
    if (loading || !user) return;
    const next = withFriendNames(contacts, friendsById);
    if (next === contacts) return;
    setContacts(next);
    persistContacts(next).catch((err) => console.error('Syncing guest names from Friends failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, friendsById, loading, user]);

  const friendsSorted = useMemo(
    () => [...friends].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [friends],
  );

  const groups = useMemo(() => {
    const set = new Set(savedGroups.filter(Boolean));
    contacts.forEach((c) => { if (c.group) set.add(c.group); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contacts, savedGroups]);

  const sides = useMemo(() => {
    const set = new Set(savedSides.filter(Boolean));
    contacts.forEach((c) => { if (c.side) set.add(c.side); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contacts, savedSides]);

  // Wedding groups (households / parties): the names in use, couples from
  // Comes With, and everyone's place in their group — lib/weddingParty.js.
  const parties = useMemo(() => {
    const byKey = new Map();
    contacts.forEach((c) => { const k = partyKey(c.party); if (k && !byKey.has(k)) byKey.set(k, c.party.trim()); });
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [contacts]);
  const partners = useMemo(() => partnerMap(contacts, friendsById), [contacts, friendsById]);
  const partyPos = useMemo(() => partyPositions(contacts, partners), [contacts, partners]);

  // A saved description (even an empty one, meaning "cleared") beats the default.
  const groupDescription = (g) => (
    Object.prototype.hasOwnProperty.call(groupDescriptions, g) ? groupDescriptions[g] : (TIER_DESCRIPTIONS[g] || '')
  );

  const categories = useMemo(() => {
    const set = new Set(savedCategories.filter(Boolean));
    contacts.forEach((c) => { if (c.category) set.add(c.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contacts, savedCategories]);

  /* Subcategories belong to a category: Family might split into Dan's side
     and Joanne's side, Work into each office. Each category's dropdown offers
     only the subcategories already used inside it, so they never leak across.
     They're read off the guests rather than saved separately — a new one is
     made by giving it to a guest, and it goes when nobody has it. */
  const subcategoriesByCategory = useMemo(() => {
    const m = new Map();
    for (const c of contacts) {
      const cat = (c.category || '').trim();
      const sub = (c.subcategory || '').trim();
      if (!cat || !sub) continue;
      if (!m.has(cat)) m.set(cat, new Set());
      m.get(cat).add(sub);
    }
    const out = new Map();
    for (const [cat, set] of m) out.set(cat, Array.from(set).sort((a, b) => a.localeCompare(b)));
    return out;
  }, [contacts]);
  const subcategoriesFor = (cat) => subcategoriesByCategory.get((cat || '').trim()) || [];

  // Guest count summaries broken down by Category (A/B/C tiers) and by Group.
  // Tiers sort A→B→C first, everything else alphabetical, unassigned last.
  const shownContacts = useMemo(() => contacts.filter((c) => !isHidden(c)), [contacts]);

  const summaries = useMemo(() => {
    const build = (field) => {
      const m = new Map();
      for (const c of shownContacts) {
        const k = (c[field] || '').trim() || '—';
        m.set(k, (m.get(k) || 0) + 1);
      }
      const tierRank = { A: 0, B: 1, C: 2 };
      return Array.from(m.entries()).sort((a, b) => {
        if (a[0] === '—') return 1;
        if (b[0] === '—') return -1;
        const ra = tierRank[a[0]] ?? 99;
        const rb = tierRank[b[0]] ?? 99;
        return ra !== rb ? ra - rb : a[0].localeCompare(b[0]);
      });
    };
    return { category: build('category'), group: build('group') };
  }, [shownContacts]);

  /* All, then the guests with no category, then one subtab per category.

     All comes first and holds everyone; Not categorized holds only the guests
     with no category — the ones still to sort. The categories follow alphabetically rather than
     biggest-first, so a tab never moves while you are working: reassigning a
     guest changes its count, not its place. A category saved with nobody in
     it yet still gets a tab (showing 0), since it exists to be filled. Counts
     are of the whole list, not of whatever the search or other filters are
     currently showing. */
  const categoryTabs = useMemo(() => {
    const counts = new Map(categories.map((cat) => [cat, 0]));
    let none = 0;
    let shown = 0;
    for (const c of contacts) {
      const cat = (c.category || '').trim();
      if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
      else none += 1;
      if (!isHidden(c)) shown += 1;
    }
    // The Hide tab goes last: it's where hidden guests can still be found and
    // un-hidden, not one of the list's real groups.
    const entries = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const toTab = ([cat, n]) => ({ value: cat, label: cat, count: n });
    return [
      { value: '', label: 'All', count: shown },
      { value: UNSORTED, label: 'Not categorized', count: none },
      ...entries.filter(([cat]) => cat.toLowerCase() !== HIDE_CATEGORY).map(toTab),
      ...entries.filter(([cat]) => cat.toLowerCase() === HIDE_CATEGORY).map(toTab),
    ];
  }, [contacts, categories]);

  // The subtab is the Category column's filter, not a second one beside it,
  // so the tab, the column header and the table can never disagree. With the
  // column set to Everyone, the All tab is lit.
  const activeCategoryTab = columnFilters.category || '';
  const filtersChanged = Object.keys({ ...DEFAULT_FILTERS, ...columnFilters })
    .some((k) => (columnFilters[k] || '') !== (DEFAULT_FILTERS[k] || ''));
  // A subcategory filter belongs to the category it was picked under, so
  // moving to another tab drops it rather than leaving an empty table.
  function selectCategoryTab(value) {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (value) next.category = value;
      else delete next.category;
      if (next.category !== prev.category) delete next.subcategory;
      return next;
    });
  }

  // Click a summary chip to filter the table by that value; click it again to
  // clear. The '—' bucket maps to the "no value" filter sentinel.
  const summaryFilterValue = (val) => (val === '—' ? '__none__' : val);
  function toggleSummaryFilter(field, val) {
    const fv = summaryFilterValue(val);
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (next[field] === fv) delete next[field];
      else next[field] = fv;
      return next;
    });
  }

  const states = useMemo(() => {
    const set = new Set(contacts.map((c) => c.state).filter(Boolean));
    return Array.from(set).sort();
  }, [contacts]);

  const visibleColumns = useMemo(() => {
    return ALL_COLUMNS.filter((col) => {
      const cfg = columnConfig[col.key];
      if (cfg && typeof cfg.visible === 'boolean') return cfg.visible;
      return DEFAULT_VISIBLE.includes(col.key);
    });
  }, [columnConfig]);

  const widthFor = (key) => {
    const cfg = columnConfig[key];
    const fallback = ALL_COLUMNS.find((c) => c.key === key)?.defaultWidth || 140;
    return (cfg && typeof cfg.width === 'number' && cfg.width > 0) ? cfg.width : fallback;
  };

  const importRows = useMemo(() => parsePastedCells(importText), [importText]);
  // What the paste would do to the list: who's new, whose blanks get filled.
  const importPlan = useMemo(() => {
    if (importRows.length === 0) return null;
    const dataRows = importHasHeader ? importRows.slice(1) : importRows;
    return planGuestImport(contacts, dataRows, importMappings, { overwrite: importOverwrite });
  }, [importRows, importMappings, importHasHeader, importOverwrite, contacts]);
  const importChangeCount = importPlan ? importPlan.added.length + importPlan.updated.length : 0;

  /* The table's order for a set of rows: the picked column's sort (or the
     default by name, RSVP'd sunk) and, in group view, each wedding group
     pulled into one block. The export runs every tab through this too, so the
     file lists guests exactly as the table does. */
  const orderRows = useCallback((rows) => {
    if (sortKey === 'party') {
      // A household stays together in its saved order whoever has RSVP'd;
      // guests with no group stay at the bottom either way.
      const sign = sortDir === 'desc' ? -1 : 1;
      const sorted = [...rows].sort((a, b) => {
        const ka = partyKey(a.party);
        const kb = partyKey(b.party);
        if (!ka !== !kb) return ka ? -1 : 1;
        if (ka !== kb) return ka.localeCompare(kb, undefined, { numeric: true }) * sign;
        return (partyPos.get(a.id) ?? 0) - (partyPos.get(b.id) ?? 0);
      });
      return groupView ? keepCouplesTogether(sorted, partners, { sameGroupOnly: true }) : sorted;
    }
    // No header picked yet: by name, Confirmed and Not coming sunk to the
    // bottom. A picked header sorts by that column alone.
    const col = ALL_COLUMNS.find((c) => c.key === (sortKey || 'name')) || ALL_COLUMNS[0];
    const value = sortKey === 'friend' ? (c) => friendsById.get(c.friendId)?.name || '' : col.sortBy;
    const sorted = [...rows].sort(makeGuestComparator({ value, dir: sortDir, sinkStatus: !sortKey }));
    if (!groupView) return sorted;
    // Group view: each wedding group as one block where its first member
    // landed; couples outside a group only paired when they tie on a picked
    // column, so that column's order is never broken for them.
    return groupPartiesTogether(sorted, partners, sortKey ? { canPair: (a, b) => sameSortValue(value(a), value(b)) } : {});
  }, [sortKey, sortDir, friendsById, partyPos, partners, groupView]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const containsCi = (haystack, needle) => (haystack || '').toLowerCase().includes(needle.toLowerCase());
    const passes = (c, key, val) => {
      if (!val) return true;
      switch (key) {
        case 'name': return containsCi(`${c.firstName || ''} ${c.lastName || ''}`, val);
        case 'group':
          if (val === '__none__') return !c.group;
          return c.group === val;
        case 'category':
          if (val === '__none__') return !c.category;
          return c.category === val;
        case 'subcategory':
          if (val === '__none__') return !c.subcategory;
          return c.subcategory === val;
        case 'guestOf':
          if (val === '__none__') return !c.guestOf;
          return c.guestOf === val;
        case 'side':
          if (val === '__none__') return !c.side;
          return c.side === val;
        case 'party':
          if (val === '__none__') return !partyKey(c.party);
          return partyKey(c.party) === partyKey(val);
        case 'state': return c.state === val;
        case 'status':
          if (val === '__none__') return !c.status;
          return c.status === val;
        case 'friend':
          if (val === '__linked__') return !!(c.friendId && friendsById.has(c.friendId));
          if (val === '__unlinked__') return !c.friendId || !friendsById.has(c.friendId);
          return c.friendId === val;
        case 'email': return containsCi(c.email, val);
        case 'phone': return containsCi(c.phone, val);
        case 'address': return containsCi(c.address, val);
        case 'city': return containsCi(c.city, val);
        case 'zip': return containsCi(c.zip, val);
        default: return true;
      }
    };
    // Hidden guests only show when you've asked for them by opening the
    // Hide tab (or picking Hide in the Category filter).
    const showingHidden = String(columnFilters.category || '').trim().toLowerCase() === HIDE_CATEGORY;
    let rows = showingHidden ? contacts : contacts.filter((c) => !isHidden(c));
    // A search stays inside the tab you're on; the All tab searches everyone.
    const activeKeys = Object.keys(columnFilters).filter((k) => columnFilters[k]);
    if (activeKeys.length) {
      rows = rows.filter((c) => activeKeys.every((k) => passes(c, k, columnFilters[k])));
    }
    if (q) {
      rows = rows.filter((c) => {
        const hay = `${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${c.phone || ''} ${c.address || ''} ${c.city || ''} ${c.state || ''} ${c.zip || ''} ${c.group || ''} ${c.category || ''} ${c.subcategory || ''} ${c.guestOf || ''} ${c.side || ''} ${c.party || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return orderRows(rows);
  }, [contacts, search, columnFilters, friendsById, orderRows]);
  // Boxes around wedding groups and couples — group view only.
  const outlines = useMemo(() => (groupView ? rowOutlines(filtered, partners) : new Map()), [filtered, partners, groupView]);
  // Their colours, as the CSS variables the outlines and the key's swatches read.
  const outlineVars = {
    '--wd-group': isHexColor(outlineColors.group) ? outlineColors.group : DEFAULT_OUTLINE_COLORS.group,
    '--wd-couple': isHexColor(outlineColors.couple) ? outlineColors.couple : DEFAULT_OUTLINE_COLORS.couple,
  };

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  // The whole list (minus hidden guests) as a formatted .xlsx. ExcelJS is
  // big, so it only loads when someone actually exports.
  async function exportToExcel(columns) {
    if (exporting) return;
    setExporting(true);
    try {
      const { default: ExcelJS } = await import('exceljs');
      // A sheet per tab you can click on the page, holding the guests that tab
      // shows (whatever the search or column filters are), in the table's
      // order. Empty category tabs are left out; All is always there.
      const tabs = categoryTabs.map((t) => {
        let rows;
        if (!t.value) rows = contacts.filter((c) => !isHidden(c));
        else if (t.value === UNSORTED) rows = contacts.filter((c) => !c.category);
        else rows = contacts.filter((c) => c.category === t.value && (t.value.trim().toLowerCase() === HIDE_CATEGORY || !isHidden(c)));
        const guests = orderRows(rows);
        let boxes = null;
        if (groupView) {
          boxes = new Map();
          for (const [id, o] of rowOutlines(guests, partners)) {
            boxes.set(id, { group: hiddenOutlines.group ? undefined : o.group, couple: hiddenOutlines.couple ? undefined : o.couple });
          }
        }
        return { label: t.label, guests, outlines: boxes };
      }).filter((t, i) => i === 0 || t.guests.length > 0);
      const buf = await buildGuestWorkbook(ExcelJS, contacts, {
        tabs,
        columns,
        outlineColors: { group: outlineVars['--wd-group'], couple: outlineVars['--wd-couple'] },
      });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Guest list export failed', err);
      alert('Could not build the Excel file. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  // A → Z, then Z → A, then back to the default view. A drag on a column's
  // resize handle that ends over its header still fires a click there — that
  // one isn't a sort.
  const setSort = (key) => {
    if (resizedRef.current) return;
    if (key !== sortKey) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortKey(''); setSortDir('asc'); }
  };

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleIds = filtered.map((c) => c.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkFieldChange = (val) => {
    setBulkField(val);
    setBulkValue('');
  };

  const handleBulkGroupChange = (val) => {
    if (val === NEW_GROUP_SENTINEL) {
      const name = (prompt('New group name?') || '').trim();
      if (!name) return;
      const nextSaved = Array.from(new Set([...savedGroups, name])).sort((a, b) => a.localeCompare(b));
      setSavedGroups(nextSaved);
      persistGroups(nextSaved);
      setBulkValue(name);
      return;
    }
    setBulkValue(val);
  };

  const handleBulkCategoryChange = (val) => {
    if (val === NEW_CATEGORY_SENTINEL) {
      const name = (prompt('New category name?') || '').trim();
      if (!name) return;
      const nextSaved = Array.from(new Set([...savedCategories, name])).sort((a, b) => a.localeCompare(b));
      setSavedCategories(nextSaved);
      persistCategories(nextSaved);
      setBulkValue(name);
      return;
    }
    setBulkValue(val);
  };

  // The subcategories on offer in bulk edit are those of the selected guests'
  // categories, since that's all they can be given.
  const bulkSubcategories = (() => {
    if (bulkField !== 'subcategory') return [];
    const set = new Set();
    for (const c of contacts) {
      if (selected.has(c.id)) subcategoriesFor(c.category).forEach((s) => set.add(s));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  })();

  const handleBulkSubcategoryChange = (val) => {
    if (val === NEW_SUBCATEGORY_SENTINEL) {
      const name = (prompt('New subcategory name?') || '').trim();
      if (name) setBulkValue(name);
      return;
    }
    setBulkValue(val);
  };

  const applyBulkEdit = async () => {
    if (!user || selected.size === 0) return;
    const next = contacts.map((c) => {
      if (!selected.has(c.id)) return c;
      // A subcategory only means something under a category, so guests
      // without one are left alone.
      if (bulkField === 'subcategory') return c.category ? { ...c, subcategory: bulkValue } : c;
      // A new category takes its own subcategories, not the old one's.
      if (bulkField === 'category') {
        return c.category === bulkValue ? c : { ...c, category: bulkValue, subcategory: '' };
      }
      // Joining a different wedding group: their old place means nothing there.
      if (bulkField === 'party') {
        return partyKey(c.party) === partyKey(bulkValue) ? c : { ...c, party: bulkValue, partyOrder: null };
      }
      return { ...c, [bulkField]: bulkValue };
    });
    await persistContacts(next);
    setBulkValue('');
    // Categorizing from a tab moves everyone selected onto another one and
    // out of sight. Left selected, they'd be caught by the next bulk edit
    // or delete without being on screen, so the selection goes with them.
    if (bulkField === 'category') clearSelection();
  };

  const deleteSelected = async () => {
    if (!user || selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} contact${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const next = contacts.filter((c) => !selected.has(c.id));
    await persistContacts(next);
    clearSelection();
  };

  const toggleColumn = (key) => {
    const isVisible = visibleColumns.some((c) => c.key === key);
    const next = { ...columnConfig, [key]: { ...columnConfig[key], visible: !isVisible } };
    setColumnConfig(next);
    persistColumnConfig(next);
  };

  const createGroup = () => {
    const name = (prompt('New group name?') || '').trim();
    if (!name) return;
    if (savedGroups.includes(name)) return;
    const nextSaved = Array.from(new Set([...savedGroups, name])).sort((a, b) => a.localeCompare(b));
    setSavedGroups(nextSaved);
    persistGroups(nextSaved);
  };

  const openGroupEditor = () => {
    const counts = new Map();
    contacts.forEach((c) => { if (c.group) counts.set(c.group, (counts.get(c.group) || 0) + 1); });
    setGroupEditor(groups.map((g) => ({ from: g, name: g, desc: groupDescription(g), count: counts.get(g) || 0 })));
  };
  const setGroupRow = (i, key, value) => setGroupEditor((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  /* Renaming a group renames it on every guest in it, and its description
     goes with it. Renaming one onto another's name merges the two. A blank
     name keeps the old one, so a group only goes away when you press its
     Delete: then it leaves the dropdowns and is cleared off every guest who
     had it (they read "— None —"), and its description goes too. Nothing
     changes until Save, so a Delete pressed by mistake is undone in place. */
  const saveGroupEditor = async () => {
    if (!groupEditor) return;
    const renames = new Map();
    const nextDescs = {};
    for (const r of groupEditor) {
      if (r.deleted) { renames.set(r.from, ''); continue; }
      const name = r.name.trim() || r.from;
      renames.set(r.from, name);
      const desc = r.desc.trim();
      // Keep the first non-empty description when two groups merge.
      if (!nextDescs[name]) nextDescs[name] = desc;
    }
    // Groups that aren't in the editor (none today) keep their descriptions.
    for (const [g, d] of Object.entries(groupDescriptions)) {
      if (!renames.has(g) && !(g in nextDescs)) nextDescs[g] = d;
    }
    delete nextDescs[''];
    const nextSaved = Array.from(new Set(savedGroups.map((g) => (renames.has(g) ? renames.get(g) : g)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
    const changed = groupEditor.some((r) => r.deleted || (r.name.trim() || r.from) !== r.from);
    const nextContacts = changed
      ? contacts.map((c) => (c.group && renames.has(c.group) && renames.get(c.group) !== c.group ? { ...c, group: renames.get(c.group) } : c))
      : contacts;
    // A filter on a renamed group follows it rather than emptying the table;
    // a filter on a deleted one is dropped.
    if (columnFilters.group && renames.has(columnFilters.group)) {
      setColumnFilters((prev) => {
        const next = { ...prev };
        const to = renames.get(prev.group);
        if (to) next.group = to;
        else delete next.group;
        return next;
      });
    }
    setGroupEditor(null);
    setSavedGroups(nextSaved);
    setGroupDescriptions(nextDescs);
    if (!user) return;
    await setDoc(
      doc(db, 'users', user.uid),
      { weddingGroups: nextSaved, weddingGroupDescriptions: nextDescs, ...(changed ? { weddingContacts: nextContacts } : {}) },
      { merge: true },
    );
  };

  const createCategory = () => {
    const name = (prompt('New category name?') || '').trim();
    if (!name) return;
    if (savedCategories.includes(name)) return;
    const nextSaved = Array.from(new Set([...savedCategories, name])).sort((a, b) => a.localeCompare(b));
    setSavedCategories(nextSaved);
    persistCategories(nextSaved);
  };

  const openCategoryEditor = () => {
    const counts = new Map();
    contacts.forEach((c) => { if (c.category) counts.set(c.category, (counts.get(c.category) || 0) + 1); });
    setCategoryEditor(categories.map((g) => ({ from: g, name: g, count: counts.get(g) || 0, deleted: false })));
  };
  const setCategoryRow = (i, key, value) => setCategoryEditor((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  /* Same rules as the group editor. Renaming renames it on every guest in it
     and two rows given one name merge. Delete takes the category out of the
     dropdowns and the subtabs and clears it off its guests, who go back to
     the list still to sort. */
  const saveCategoryEditor = async () => {
    if (!categoryEditor) return;
    const renames = new Map();
    for (const r of categoryEditor) renames.set(r.from, r.deleted ? '' : (r.name.trim() || r.from));
    const nextSaved = Array.from(new Set(savedCategories.map((g) => (renames.has(g) ? renames.get(g) : g)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
    const changed = categoryEditor.some((r) => r.deleted || (r.name.trim() || r.from) !== r.from);
    const nextContacts = changed
      ? contacts.map((c) => {
        if (!c.category || !renames.has(c.category) || renames.get(c.category) === c.category) return c;
        const to = renames.get(c.category);
        // Subcategories ride along with a rename or merge; a deleted category
        // takes its subcategories with it.
        return to ? { ...c, category: to } : { ...c, category: '', subcategory: '' };
      })
      : contacts;
    // The open subtab follows a renamed category; if it was deleted, you land
    // on the still-to-sort tab, which is where its guests just went.
    if (columnFilters.category && renames.has(columnFilters.category)) {
      setColumnFilters((prev) => {
        const to = renames.get(prev.category);
        const next = { ...prev, category: to || UNSORTED };
        if (!to) delete next.subcategory;
        return next;
      });
    }
    setCategoryEditor(null);
    setSavedCategories(nextSaved);
    if (!user) return;
    await setDoc(
      doc(db, 'users', user.uid),
      { weddingCategories: nextSaved, ...(changed ? { weddingContacts: nextContacts } : {}) },
      { merge: true },
    );
  };

  const handleRowSideChange = async (id, val) => {
    const side = val === NEW_SIDE_SENTINEL ? promptNewSide() : val;
    if (val === NEW_SIDE_SENTINEL && !side) return;
    const next = contacts.map((c) => (c.id === id ? { ...c, side } : c));
    await persistContacts(next);
  };

  // Typed or picked in the Wedding group cell. A new group starts them at the
  // end of it; their Comes With partner follows (persistContacts).
  const handleRowPartyChange = async (id, val) => {
    const party = String(val || '').trim();
    const next = contacts.map((c) => {
      if (c.id !== id) return c;
      if (partyKey(c.party) === partyKey(party)) return party === (c.party || '').trim() ? c : { ...c, party };
      return { ...c, party, partyOrder: null };
    });
    await persistContacts(next);
  };

  const handleRowGroupChange = async (id, val) => {
    let groupName = val;
    if (val === NEW_GROUP_SENTINEL) {
      const name = (prompt('New group name?') || '').trim();
      if (!name) return;
      const nextSaved = Array.from(new Set([...savedGroups, name])).sort((a, b) => a.localeCompare(b));
      setSavedGroups(nextSaved);
      persistGroups(nextSaved);
      groupName = name;
    }
    const next = contacts.map((c) => (c.id === id ? { ...c, group: groupName } : c));
    await persistContacts(next);
  };

  const handleRowCategoryChange = async (id, val) => {
    let catName = val;
    if (val === NEW_CATEGORY_SENTINEL) {
      const name = (prompt('New category name?') || '').trim();
      if (!name) return;
      const nextSaved = Array.from(new Set([...savedCategories, name])).sort((a, b) => a.localeCompare(b));
      setSavedCategories(nextSaved);
      persistCategories(nextSaved);
      catName = name;
    }
    // Moving to another category clears the subcategory: it was one of the
    // old category's, and wouldn't appear in the new one's dropdown.
    const next = contacts.map((c) => (
      c.id === id && c.category !== catName ? { ...c, category: catName, subcategory: '' } : c
    ));
    await persistContacts(next);
    // The row has just moved to another tab; it shouldn't stay selected there.
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  };

  const handleRowSubcategoryChange = async (id, val) => {
    let subName = val;
    if (val === NEW_SUBCATEGORY_SENTINEL) {
      subName = (prompt('New subcategory name?') || '').trim();
      if (!subName) return;
    }
    const next = contacts.map((c) => (c.id === id ? { ...c, subcategory: subName } : c));
    await persistContacts(next);
  };

  const handleRowGuestOfChange = async (id, val) => {
    const next = contacts.map((c) => (c.id === id ? { ...c, guestOf: val } : c));
    await persistContacts(next);
  };

  const handleRowStatusChange = async (id, val) => {
    const next = contacts.map((c) => (c.id === id ? { ...c, status: val } : c));
    await persistContacts(next);
  };

  const handleRowFriendChange = async (id, val) => {
    const next = contacts.map((c) => (c.id === id ? { ...c, friendId: val } : c));
    await persistContacts(next);
  };

  const autoMatchFriends = async () => {
    if (friends.length === 0) {
      alert('No Friends contacts found. Add some on the Friends page first.');
      return;
    }
    const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normEmail = (s) => (s || '').toLowerCase().trim();
    const normPhone = (s) => {
      const digits = (s || '').replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    };
    const addToIndex = (map, ambig, key, id) => {
      if (!key) return;
      if (map.has(key) && map.get(key) !== id) ambig.add(key);
      else map.set(key, id);
    };
    const byName = new Map(); const ambigName = new Set();
    const byEmail = new Map(); const ambigEmail = new Set();
    const byPhone = new Map(); const ambigPhone = new Set();
    friends.forEach((f) => {
      addToIndex(byName, ambigName, normName(f.name), f.id);
      addToIndex(byEmail, ambigEmail, normEmail(f.email), f.id);
      addToIndex(byEmail, ambigEmail, normEmail(f.workEmail), f.id);
      const ph = normPhone(f.phone);
      if (ph.length >= 10) addToIndex(byPhone, ambigPhone, ph, f.id);
    });
    const lookup = (map, ambig, key, minLen = 1) => {
      if (!key || key.length < minLen) return null;
      if (ambig.has(key)) return null;
      return map.get(key) || null;
    };
    let matched = 0;
    const byStrategy = { name: 0, email: 0, phone: 0 };
    const next = contacts.map((c) => {
      if (c.friendId && friendsById.has(c.friendId)) return c;
      const nameKey = normName(`${c.firstName || ''}${c.lastName || ''}`);
      const emailKey = normEmail(c.email);
      const phoneKey = normPhone(c.phone);
      const hit =
        lookup(byName, ambigName, nameKey) ||
        lookup(byEmail, ambigEmail, emailKey) ||
        lookup(byPhone, ambigPhone, phoneKey, 10);
      if (!hit) return c;
      matched += 1;
      if (lookup(byName, ambigName, nameKey)) byStrategy.name += 1;
      else if (lookup(byEmail, ambigEmail, emailKey)) byStrategy.email += 1;
      else byStrategy.phone += 1;
      return { ...c, friendId: hit };
    });
    if (matched === 0) {
      alert('No new matches found.');
      return;
    }
    await persistContacts(next);
    alert(
      `Matched ${matched} contact${matched === 1 ? '' : 's'} to Friends ` +
      `(${byStrategy.name} by name, ${byStrategy.email} by email, ${byStrategy.phone} by phone).`,
    );
  };

  const startResize = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthFor(key);
    dragRef.current = { key, startX, startWidth };
    document.body.classList.add('rally-col-resizing');
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const { key: k, startX: sx, startWidth: sw } = dragRef.current;
      const next = Math.max(60, sw + (ev.clientX - sx));
      setColumnConfig((prev) => ({ ...prev, [k]: { ...prev[k], width: next } }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('rally-col-resizing');
      persistColumnConfig(columnConfigRef.current);
      dragRef.current = null;
      resizedRef.current = true;
      setTimeout(() => { resizedRef.current = false; }, 0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const totalWidth = 36 + visibleColumns.reduce((sum, col) => sum + widthFor(col.key), 0);

  const setColumnFilter = (key, val) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (val) next[key] = val;
      else delete next[key];
      if (key === 'category' && next.category !== prev.category) delete next.subcategory;
      return next;
    });
  };

  const renderFilterCell = (col) => {
    const v = columnFilters[col.key] || '';
    const onSel = (e) => setColumnFilter(col.key, e.target.value);
    const onTxt = (e) => setColumnFilter(col.key, e.target.value);
    switch (col.key) {
      case 'group':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            <option value="__none__">— None —</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        );
      case 'category':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">Everyone</option>
            <option value="__none__">— None —</option>
            {categories.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        );
      case 'subcategory': {
        // On a category's tab, that category's subcategories; otherwise every
        // name in use, once each.
        const cat = columnFilters.category;
        const opts = cat && cat !== UNSORTED
          ? subcategoriesFor(cat)
          : Array.from(new Set([...subcategoriesByCategory.values()].flat())).sort((a, b) => a.localeCompare(b));
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            <option value="__none__">— None —</option>
            {v && v !== '__none__' && !opts.includes(v) && <option value={v}>{v}</option>}
            {opts.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        );
      }
      case 'guestOf':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            <option value="__none__">— None —</option>
            {GUEST_OF_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        );
      case 'side':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            <option value="__none__">— None —</option>
            {sides.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        );
      case 'party':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            <option value="__none__">— None —</option>
            {parties.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        );
      case 'status':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            <option value="__none__">— None —</option>
            {STATUS_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        );
      case 'state':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        );
      case 'friend':
        return (
          <select className={styles.filterSelect} value={v} onChange={onSel}>
            <option value="">All</option>
            <option value="__linked__">Linked</option>
            <option value="__unlinked__">Unlinked</option>
            {friendsSorted.map((f) => <option key={f.id} value={f.id}>{f.name || f.email || f.id}</option>)}
          </select>
        );
      default:
        return (
          <input
            className={styles.filterInput}
            value={v}
            onChange={onTxt}
            placeholder="Filter…"
          />
        );
    }
  };
  const importColCount = importRows.reduce((m, r) => Math.max(m, r.length), 0);
  const importPreviewRows = importHasHeader ? importRows.slice(1) : importRows;

  const openImport = () => {
    setImportOpen(true);
    setImportText('');
    setImportHasHeader(true);
    setImportMappings([]);
    setImportOverwrite(false);
  };
  const closeImport = () => setImportOpen(false);

  // A guest linked to a Friends contact opens that contact's Friends pop-up
  // (viaFriend); one without falls back to the guest-only pop-up below. The
  // link is trusted rather than checked against `friends` here, which may not
  // have loaded yet — if the contact turns out to be gone, the embedded pop-up
  // reports it (onMissing) and the guest-only one opens instead.
  const openContact = (c) => {
    const draft = {};
    for (const f of CONTACT_FORM_FIELDS) draft[f.key] = c[f.key] || '';
    draft.friendId = c.friendId || '';
    const viaFriend = !!c.friendId;
    setEditing({ id: c.id, draft, viaFriend });
  };

  /* Saving the Friends pop-up for a guest: the friend is already written (by
     FriendsPage); this saves the wedding box and copies the name, email and
     phone back so the guest row says what the contact says. The name is only
     re-split when it actually changed, so "Mary Ann" / "Smith" survives. */
  const saveGuestFromFriend = async (friend) => {
    const editing = editingRef.current;
    const contacts = contactsRef.current;
    if (!editing) return;
    const patch = {};
    for (const f of WEDDING_ONLY_FIELDS) {
      const v = editing.draft[f.key];
      patch[f.key] = typeof v === 'string' ? v.trim() : v;
    }
    if (!patch.category) patch.subcategory = '';
    const guest = contacts.find((c) => c.id === editing.id);
    if (!guest) return;
    // A new wedding group starts them at the end of it.
    if (partyKey(guest.party) !== partyKey(patch.party)) patch.partyOrder = null;
    const name = (friend.name || '').trim();
    if (name && name !== `${guest.firstName || ''} ${guest.lastName || ''}`.trim()) {
      Object.assign(patch, splitGuestName(name));
    }
    if ((friend.email || '') !== (guest.email || '').trim().toLowerCase()) patch.email = friend.email || '';
    if ((friend.phone || '').trim() !== (guest.phone || '').trim()) patch.phone = (friend.phone || '').trim();
    await persistContacts(contacts.map((c) => (c.id === editing.id ? { ...c, ...patch } : c)));
  };

  // One field of the guest pop-up's draft — shared by the guest-only pop-up
  // and the wedding box inside the Friends one.
  const renderDraftField = (f) => (
    <label key={f.key} className={f.wide ? `${styles.contactField} ${styles.contactWide}` : styles.contactField}>
      <span className={styles.contactLabel}>{f.label}</span>
      {f.key === 'guestOf' ? (
        <select className={styles.contactInput} value={editing.draft.guestOf} onChange={(e) => setDraftField('guestOf', e.target.value)}>
          <option value="">— None —</option>
          {GUEST_OF_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      ) : f.key === 'status' ? (
        <select className={styles.contactInput} value={editing.draft.status} onChange={(e) => setDraftField('status', e.target.value)}>
          <option value="">— None —</option>
          {STATUS_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      ) : (
        <input
          className={styles.contactInput}
          type={f.type || 'text'}
          list={f.key === 'group' ? 'wedding-groups' : f.key === 'side' ? 'wedding-sides' : f.key === 'party' ? 'wedding-parties' : f.key === 'category' ? 'wedding-categories' : f.key === 'subcategory' ? 'wedding-subcategories' : undefined}
          placeholder={f.key === 'subcategory' && !editing.draft.category.trim() ? 'Pick a category first' : undefined}
          disabled={f.key === 'subcategory' && !editing.draft.category.trim()}
          value={editing.draft[f.key]}
          onChange={(e) => setDraftField(f.key, e.target.value)}
          autoComplete="off"
        />
      )}
    </label>
  );
  const draftDatalists = editing && (
    <>
      <datalist id="wedding-parties">{parties.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="wedding-sides">{sides.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="wedding-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="wedding-categories">{categories.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="wedding-subcategories">
        {subcategoriesFor(editing.draft.category).map((g) => <option key={g} value={g} />)}
      </datalist>
    </>
  );

  /* Under the Wedding group field: who else is in the group, in order, with
     ↑/↓ to reorder (saved straight away — it moves other guests too, so it
     can't wait on this pop-up's Save). Couples from Comes With are one row and
     move together. If this guest's Comes With partner is on the list but not
     in the group, say so and offer to bring them in. */
  const renderPartyPanel = () => {
    if (!editing) return null;
    const draftParty = String(editing.draft.party || '').trim();
    const key = partyKey(draftParty);
    const me = editing.id ? contacts.find((c) => c.id === editing.id) : null;
    const partner = me && partners.has(me.id) ? contacts.find((c) => c.id === partners.get(me.id)) : null;
    if (!key && !partner) return null;
    const members = key ? contacts.filter((c) => partyKey(c.party) === key && !isHidden(c)) : [];
    const units = partyUnits(members, partners);
    const meSaved = !!me && partyKey(me.party) === key;
    const myName = `${editing.draft.firstName || ''} ${editing.draft.lastName || ''}`.trim() || guestName(me) || 'this guest';
    const reorder = async (i, dir) => {
      const next = moveUnit(units, i, dir);
      if (next === units) return;
      const order = orderFromUnits(next);
      await persistContacts(contacts.map((c) => (order.has(c.id) ? { ...c, partyOrder: order.get(c.id) } : c)));
    };
    const bringPartner = () => persistContacts(contacts.map((c) => (c.id === partner.id ? { ...c, party: draftParty, partyOrder: null } : c)));
    const partnerOutside = partner && partyKey(partner.party) !== key;
    return (
      <div className={styles.partyPanel} data-testid="party-panel">
        {partnerOutside && (
          <div className={styles.partyCouple}>
            <span>💑 Comes with <strong>{guestName(partner)}</strong>{partner.party ? ` · in ${partner.party}` : ''}</span>
            {key ? (
              <button type="button" className={styles.partyLink} onClick={bringPartner}>Add to {draftParty}</button>
            ) : partner.party ? (
              <button type="button" className={styles.partyLink} onClick={() => setDraftField('party', partner.party)}>Join {partner.party}</button>
            ) : null}
          </div>
        )}
        {key && (
          <>
            <div className={styles.partyHead}>
              In {draftParty} · {members.length} {members.length === 1 ? 'person' : 'people'}
            </div>
            {!meSaved && <p className={styles.partyNote}>Save to add {myName} to this group.</p>}
            {units.length > 0 && (
              <ol className={styles.partyList}>
                {units.map((u, i) => {
                  const label = u.map(guestName).join(' & ');
                  const mine = me && u.some((g) => g.id === me.id);
                  return (
                    <li key={u[0].id} className={mine ? styles.partyRowMine : styles.partyRow}>
                      <span className={styles.partyPos}>{i + 1}</span>
                      <span className={styles.partyName}>{u.length > 1 && <span aria-label="couple">💑 </span>}{label}</span>
                      <button type="button" className={styles.partyMove} onClick={() => reorder(i, -1)} disabled={i === 0} aria-label={`Move ${label} up`}>↑</button>
                      <button type="button" className={styles.partyMove} onClick={() => reorder(i, 1)} disabled={i === units.length - 1} aria-label={`Move ${label} down`}>↓</button>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </div>
    );
  };

  // A new guest opens the same pop-up with an empty draft (id null). The
  // category tab you're on is filled in, so the guest lands where you are
  // looking; "Not categorized" means none.
  const openNewContact = () => {
    const draft = {};
    for (const f of CONTACT_FORM_FIELDS) draft[f.key] = '';
    draft.friendId = '';
    if (activeCategoryTab && activeCategoryTab !== '__none__') {
      draft.category = activeCategoryTab;
      const sub = columnFilters.subcategory;
      if (sub && sub !== '__none__') draft.subcategory = sub;
    }
    setEditing({ id: null, draft });
  };
  const setDraftField = (key, value) => setEditing((e) => ({ ...e, draft: { ...e.draft, [key]: value } }));
  const saveContact = async () => {
    if (!editing) return;
    const patch = {};
    for (const [k, v] of Object.entries(editing.draft)) patch[k] = typeof v === 'string' ? v.trim() : v;
    // No category, no subcategory.
    if (!patch.category) patch.subcategory = '';
    if (editing.id === null) {
      await addNewGuest(patch);
      return;
    }
    closeContact();
  };

  /* Merging duplicate guests (WeddingGuestMerge.jsx). The guest list is written
     first, already pointing at the Friends contact that's kept; then, when the
     guests were linked to different Friends contacts, those are merged on the
     Friends page by the same code its own merge screen uses. A failure between
     the two leaves an extra Friends contact, never a guest pointing at a
     deleted one. */
  const commitGuestMerge = async ({ guest, removedGuestIds, friendMerge }) => {
    if (!user) return;
    const removedFriendIds = friendMerge ? friendMerge.others.map((f) => f.id) : [];
    await persistContacts(applyGuestMerge(contacts, guest, removedGuestIds, removedFriendIds));
    if (friendMerge) {
      await commitFriendMerge(user.uid, friends, friendMerge.primary, friendMerge.others, friendMerge.choices);
    }
    setMergingGuests(null);
    clearSelection();
    const n = removedGuestIds.length + 1;
    const name = `${guest.firstName} ${guest.lastName}`.trim() || 'one guest';
    setMergeMsg(`Merged ${n} guests into ${name}${friendMerge ? `, and their ${removedFriendIds.length + 1} Friends contacts into one` : ''}.`);
  };

  // Delete in either pop-up takes the guest off the list only; a linked
  // Friends contact stays, since they're still a friend.
  const deleteContact = async () => {
    if (!user || !editing || editing.id === null) return;
    const name = `${editing.draft.firstName} ${editing.draft.lastName}`.trim() || 'this guest';
    const friendNote = friendsById.has(editing.draft.friendId) ? ' They stay on your Friends page.' : '';
    if (!confirm(`Delete ${name} from the wedding guest list?${friendNote} This cannot be undone.`)) return;
    clearTimeout(guestSaveTimer.current);
    guestSaveTimer.current = null;
    editingRef.current = null;
    const id = editing.id;
    setEditing(null);
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await persistContacts(contacts.filter((c) => c.id !== id));
  };

  /* Adding a guest by hand also puts them on the Friends page. If they're
     already a friend (same email, phone or full name) the guest is linked to
     that record instead of making a second one; a friend picked in the pop-up
     wins over both. The friend is written first so the guest is saved with
     its link — if that write fails the guest is still added, just unlinked,
     and Auto-match can pick it up later. */
  const addNewGuest = async (patch) => {
    if (!user) return;
    if (!patch.firstName && !patch.lastName) {
      alert('Add a first or last name.');
      return;
    }
    let friendId = patch.friendId || '';
    if (!friendId) {
      const existing = findFriendForGuest(friends, patch);
      if (existing) {
        friendId = existing.id;
      } else {
        try {
          friendId = (await addFriend(user.uid, friendDataFromGuest(patch))) || '';
        } catch (err) {
          console.error('Failed to add guest to Friends:', err);
          friendId = '';
        }
      }
    }
    const guest = {
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...patch,
      friendId,
    };
    setEditing(null);
    await persistContacts([...contacts, guest]);
  };

  const handleImportTextChange = (val) => {
    setImportText(val);
    const rows = parsePastedCells(val);
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (rows.length === 0 || cols === 0) {
      setImportMappings([]);
      return;
    }
    const header = rows[0] || [];
    const detected = autoDetectMappings(header);
    const filled = Array.from({ length: cols }, (_, i) => detected[i] || '');
    setImportMappings(filled);
    setImportHasHeader(looksLikeHeader(rows));
  };

  const setImportMapping = (colIdx, field) => {
    setImportMappings((prev) => {
      const next = [...prev];
      while (next.length < colIdx + 1) next.push('');
      next[colIdx] = field;
      return next;
    });
  };

  const performImport = async () => {
    const plan = importPlan;
    if (!plan || (plan.added.length === 0 && plan.updated.length === 0)) return;
    const newContacts = plan.added;
    // Closed straight away: the table shows the write at once, and the server
    // confirming it can take a few seconds. Left open, the preview would
    // re-plan against the already-updated list and read "0 new". If the save
    // fails the dialog comes back with the paste still in it.
    setImportOpen(false);
    const said = [];
    if (plan.added.length) said.push(`added ${plan.added.length} new ${plan.added.length === 1 ? 'guest' : 'guests'}`);
    if (plan.updated.length) said.push(`updated ${plan.updated.length} already on the list`);
    setImportResultMsg(`Import done: ${said.join(' and ')}.`);
    try {
      await persistContacts(plan.contacts);
    } catch (err) {
      console.error('Guest import failed:', err);
      setImportResultMsg("Couldn't save that import, so nothing changed. Your paste is still in the dialog — try again.");
      setImportOpen(true);
      return;
    }
    if (newContacts.length === 0) return;
    // Imported guests go on the Friends page too, matched to anyone already
    // there. Saved first, so a failed friend write never loses the import.
    try {
      const { created, linked } = await syncWeddingGuestsToFriends(user.uid, { onlyIds: newContacts.map((c) => c.id) });
      if (linked) setFriendSyncMsg(friendSyncSummary(created, linked));
    } catch (err) {
      console.error('Imported guests → Friends failed:', err);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        <div className={styles.count}>{filtered.length} of {shownContacts.length} contacts</div>
      </div>
      <p className={styles.subtitle}>Guest contact list. Select rows to bulk-edit a field.</p>

      {/* Weekly email. Collapsed to a single line until opened — it's a setting
          you touch once, and the guest list is what the page is for. */}
      {digestCfg && (
        <div className={styles.digest}>
          <button
            type="button"
            className={styles.digestToggle}
            onClick={() => setDigestOpen((v) => !v)}
            aria-expanded={digestOpen}
          >
            <span>📧 Weekly email</span>
            <span className={digestCfg.enabled ? styles.digestOn : styles.digestOff}>
              {digestCfg.enabled ? `On · ${WEEKDAYS[digestCfg.sendWeekday] || 'Sunday'}s at 8 AM` : 'Off'}
            </span>
            <span className={styles.digestChevron} aria-hidden="true">{digestOpen ? '▾' : '▸'}</span>
          </button>

          {digestOpen && (
            <div className={styles.digestBody}>
              <p className={styles.digestHint}>
                The checklist, mailed to you: what you&apos;ve ticked off, what you got done since
                last week, and the next thing to do. The guest list rides along at the bottom.
              </p>
              <label className={styles.digestCheck}>
                <input
                  type="checkbox"
                  checked={digestCfg.enabled}
                  onChange={(e) => saveDigest({ enabled: e.target.checked })}
                />
                <span>Email me a weekly summary</span>
              </label>

              {digestCfg.enabled && (
                <div className={styles.digestFields}>
                  <div className={styles.digestField}>
                    <span>Send to</span>
                    <div className={styles.digestEmails}>
                      {digestCfg.emails.map((addr, i) => (
                        <div key={i} className={styles.digestEmailRow}>
                          <input
                            type="email"
                            value={addr}
                            placeholder="you@example.com"
                            aria-label={`Address ${i + 1} for the weekly summary`}
                            onChange={(e) => setDigestEmail(i, e.target.value)}
                            onBlur={() => saveDigestEmails(digestCfg.emails)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          />
                          {digestCfg.emails.length > 1 && (
                            <button
                              type="button"
                              className={styles.digestEmailDrop}
                              title="Stop sending to this address"
                              aria-label={`Stop sending to ${addr || 'this address'}`}
                              onClick={() => saveDigestEmails(digestCfg.emails.filter((_, j) => j !== i))}
                            >×</button>
                          )}
                        </div>
                      ))}
                      {digestCfg.emails.length < 10 && (
                        <button
                          type="button"
                          className={styles.digestAddEmail}
                          onClick={() => setDigestCfg({ ...digestCfg, emails: [...digestCfg.emails, ''] })}
                        >+ Add another address</button>
                      )}
                    </div>
                  </div>
                  <label className={styles.digestField}>
                    <span>Every</span>
                    <select
                      value={digestCfg.sendWeekday}
                      onChange={(e) => saveDigest({ sendWeekday: Number(e.target.value) })}
                    >
                      {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </label>
                  {/* Fixed rather than a picker: the cron runs at set hours on
                      this plan, and a picker offering 6 PM would be a promise
                      nothing keeps. See isDueNow in api/wedding-digest.js. */}
                  <div className={styles.digestField}>
                    <span>At</span>
                    <div className={styles.digestTime}>8:00 AM Eastern</div>
                  </div>
                </div>
              )}

              {/* The last scheduled send, when an address on the list didn't get
                  it — otherwise a refused address is silence, which reads as "the
                  email just didn't come". */}
              {digestCfg.enabled && digestCfg.lastResult?.failed?.length > 0 && (
                <div className={styles.digestFailed} role="status">
                  <strong>
                    The {new Date(digestCfg.lastResult.at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} email
                    {digestCfg.lastResult.sentTo?.length ? ` reached ${digestCfg.lastResult.sentTo.join(', ')} but` : ''} didn&apos;t reach:
                  </strong>
                  <ul>
                    {digestCfg.lastResult.failed.map((f, i) => (
                      <li key={i}>{f.email ? `${f.email} — ` : ''}{f.error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.digestActions}>
                <button
                  type="button"
                  className={styles.digestTest}
                  onClick={sendDigestTest}
                  disabled={digestBusy}
                >
                  {digestBusy ? 'Sending…' : 'Send one to me'}
                </button>
                {digestMsg && (
                  <span className={digestMsg.type === 'ok' ? styles.digestOkMsg : styles.digestErrMsg}>
                    {digestMsg.text}
                  </span>
                )}
              </div>
              <p className={styles.digestNote}>
                Sends at 8 AM Eastern on your chosen day (some time before 9), to everyone
                above, each as their own email. A test goes to
                your own address only — nobody else on the list gets one — and doesn&apos;t
                count as the week&apos;s email, so the next one still shows what changed.
              </p>
            </div>
          )}
        </div>
      )}

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>By tier</span>
          {summaries.group.map(([val, n]) => (
            <button
              key={val}
              type="button"
              className={`${styles.summaryChip} ${columnFilters.group === summaryFilterValue(val) ? styles.summaryChipActive : ''}`}
              onClick={() => toggleSummaryFilter('group', val)}
              title={groupDescription(val) || 'Filter by this tier'}
            >
              <span className={styles.summaryChipKey}>{val === '—' ? 'Not grouped' : val}</span>
              <span className={styles.summaryChipCount}>{n}</span>
            </button>
          ))}
          <span className={styles.summaryTotal}>{shownContacts.length} total</span>
        </div>
      </div>

      <div className={styles.tierLegend}>
        <span className={styles.tierLegendTitle}>Guest tiers</span>
        {groups.filter((g) => groupDescription(g)).map((t) => (
          <span key={t} className={styles.tierLegendItem}>
            <span className={styles.tierBadge}>{t}</span>
            <span className={styles.tierDesc}>{groupDescription(t)}</span>
          </span>
        ))}
        <button className={styles.tierLegendEdit} type="button" onClick={openGroupEditor}>Edit groups</button>
      </div>

      {/* The outline key and its colours only mean something in group view. */}
      {groupView && (
      <div className={styles.tierLegend} style={outlineVars} aria-label="Table outlines">
        <span className={styles.tierLegendTitle}>Outlines</span>
        {[
          { key: 'group', label: 'Wedding group', swatch: styles.outlineSwatchGroup, fallback: DEFAULT_OUTLINE_COLORS.group },
          { key: 'couple', label: 'Couple', swatch: styles.outlineSwatchCouple, fallback: DEFAULT_OUTLINE_COLORS.couple },
        ].map((o) => (
          <label key={o.key} className={`${styles.tierLegendItem} ${hiddenOutlines[o.key] ? styles.outlineHidden : ''}`}>
            <input
              type="checkbox"
              checked={!hiddenOutlines[o.key]}
              onChange={() => toggleOutline(o.key)}
              aria-label={`Show ${o.label.toLowerCase()} outlines`}
            />
            <span className={`${styles.outlineSwatch} ${o.swatch}`} aria-hidden="true" />
            {o.label}
            <input
              type="color"
              className={styles.outlineColor}
              value={isHexColor(outlineColors[o.key]) ? outlineColors[o.key] : o.fallback}
              onChange={(e) => updateOutlineColors({ [o.key]: e.target.value })}
              aria-label={`${o.label} outline colour`}
            />
          </label>
        ))}
        {(outlineColors.group || outlineColors.couple) && (
          <button
            className={styles.tierLegendEdit}
            type="button"
            onClick={() => updateOutlineColors({ group: '', couple: '' })}
          >Reset colours</button>
        )}
      </div>
      )}

      <div className={styles.categoryTabs} role="tablist" aria-label="Guests by category">
        {categoryTabs.map((t) => (
          <button
            key={t.value || '__all__'}
            type="button"
            role="tab"
            aria-selected={activeCategoryTab === t.value}
            className={activeCategoryTab === t.value ? styles.categoryTabActive : styles.categoryTab}
            onClick={() => selectCategoryTab(t.value)}
          >
            {t.label}
            <span className={styles.categoryTabCount}>{t.count}</span>
          </button>
        ))}
      </div>
      {importResultMsg && (
        <p className={styles.categoryTabHint} role="status">
          {importResultMsg}{' '}
          <button type="button" className={styles.tierLegendEdit} onClick={() => setImportResultMsg('')}>Dismiss</button>
        </p>
      )}
      {friendSyncMsg && (
        <p className={styles.categoryTabHint} role="status">
          {friendSyncMsg}{' '}
          <button type="button" className={styles.tierLegendEdit} onClick={() => setFriendSyncMsg('')}>Dismiss</button>
        </p>
      )}
      {mergeMsg && (
        <p className={styles.categoryTabHint} role="status">
          {mergeMsg}{' '}
          <button type="button" className={styles.tierLegendEdit} onClick={() => setMergeMsg('')}>Dismiss</button>
        </p>
      )}

      {partnerMsg && (
        <p className={styles.categoryTabHint} role="status">
          {partnerMsg}{' '}
          <button type="button" className={styles.tierLegendEdit} onClick={() => setPartnerMsg('')}>Dismiss</button>
        </p>
      )}

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search by name, email, address, group…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {filtersChanged && (
          <button className={styles.toolButton} type="button" onClick={() => setColumnFilters(DEFAULT_FILTERS)}>Clear filters</button>
        )}
        <button className={styles.toolButton} type="button" onClick={createGroup}>+ Group</button>
        <button className={styles.toolButton} type="button" onClick={openGroupEditor}>Edit groups</button>
        <button className={styles.toolButton} type="button" onClick={createCategory}>+ Category</button>
        <button className={styles.toolButton} type="button" onClick={openCategoryEditor}>Edit categories</button>
        <button className={styles.toolButton} type="button" onClick={openNewContact}>+ Guest</button>
        <button className={styles.toolButton} type="button" onClick={openImport}>+ Paste from sheet</button>
        <button className={styles.toolButton} type="button" onClick={autoMatchFriends}>Auto-match Friends</button>
        <button
          className={styles.toolButton}
          type="button"
          onClick={() => setShowGuestDuplicates(true)}
          title="Find guests that share an email, phone number, name or Friends contact, and merge them"
        >Find duplicates</button>
        <button
          className={groupView ? `${styles.toolButton} ${styles.toolButtonOn}` : styles.toolButton}
          type="button"
          onClick={toggleGroupView}
          aria-pressed={groupView}
          title={groupView ? 'Wedding groups shown together and outlined. Click for the plain table.' : 'Plain table. Click to show wedding groups together and outlined.'}
        >
          Group view: {groupView ? 'On' : 'Off'}
        </button>
        <WeddingExportMenu exporting={exporting} onExport={exportToExcel} />
        <div className={styles.colMenu} ref={columnsMenuRef}>
          <button className={styles.toolButton} type="button" onClick={() => setShowColumnsMenu((s) => !s)}>
            Columns ▾
          </button>
          {showColumnsMenu && (
            <div className={styles.colMenuPopover} data-columns-menu style={columnsMenuPos || { visibility: 'hidden' }}>
              {ALL_COLUMNS.map((col) => {
                const isVisible = visibleColumns.some((c) => c.key === col.key);
                return (
                  <label key={col.key} className={styles.colMenuItem}>
                    <input type="checkbox" checked={isVisible} onChange={() => toggleColumn(col.key)} />
                    {col.label}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selected.size} selected</span>
          <span className={styles.bulkLabel}>Set</span>
          <select className={styles.bulkInput} value={bulkField} onChange={(e) => handleBulkFieldChange(e.target.value)} style={{ minWidth: 0 }}>
            {EDITABLE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <span className={styles.bulkLabel}>to</span>
          {bulkField === 'group' ? (
            <select className={styles.bulkInput} value={bulkValue} onChange={(e) => handleBulkGroupChange(e.target.value)}>
              <option value="">— (clear)</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value={NEW_GROUP_SENTINEL}>+ New group…</option>
            </select>
          ) : bulkField === 'category' ? (
            <select className={styles.bulkInput} value={bulkValue} onChange={(e) => handleBulkCategoryChange(e.target.value)}>
              <option value="">— (clear)</option>
              {categories.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value={NEW_CATEGORY_SENTINEL}>+ New category…</option>
            </select>
          ) : bulkField === 'subcategory' ? (
            <select
              className={styles.bulkInput}
              value={bulkValue}
              onChange={(e) => handleBulkSubcategoryChange(e.target.value)}
              title="Only guests with a category get a subcategory"
            >
              <option value="">— (clear)</option>
              {bulkValue && !bulkSubcategories.includes(bulkValue) && <option value={bulkValue}>{bulkValue}</option>}
              {bulkSubcategories.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value={NEW_SUBCATEGORY_SENTINEL}>+ New subcategory…</option>
            </select>
          ) : bulkField === 'side' ? (
            <select
              className={styles.bulkInput}
              value={bulkValue}
              onChange={(e) => {
                const v = e.target.value === NEW_SIDE_SENTINEL ? promptNewSide() : e.target.value;
                if (e.target.value !== NEW_SIDE_SENTINEL || v) setBulkValue(v);
              }}
            >
              <option value="">— (clear)</option>
              {sides.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value={NEW_SIDE_SENTINEL}>+ New side…</option>
            </select>
          ) : bulkField === 'guestOf' ? (
            <select className={styles.bulkInput} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">— (clear)</option>
              {GUEST_OF_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          ) : bulkField === 'status' ? (
            <select className={styles.bulkInput} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">— (clear)</option>
              {STATUS_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          ) : (
            <input
              className={styles.bulkInput}
              value={bulkValue}
              placeholder="New value (leave blank to clear)"
              onChange={(e) => setBulkValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyBulkEdit(); }}
            />
          )}
          <button className={styles.bulkApply} onClick={applyBulkEdit}>Apply</button>
          <button
            className={styles.bulkApply}
            onClick={() => setMergingGuests(contacts.filter((c) => selected.has(c.id)))}
            disabled={selected.size < 2}
            title={selected.size < 2 ? 'Select two or more guests to merge' : 'Merge the selected guests into one'}
          >Merge</button>
          <button className={styles.bulkDelete} onClick={deleteSelected}>Delete</button>
          <button className={styles.bulkClear} onClick={clearSelection}>Clear</button>
        </div>
      )}

      {showGuestDuplicates && !mergingGuests && (
        <GuestDuplicatesModal
          groups={findGuestDuplicateGroups(shownContacts)}
          onReview={(group) => setMergingGuests(group)}
          onClose={() => setShowGuestDuplicates(false)}
        />
      )}
      {mergingGuests && (
        <GuestMergeModal
          guests={mergingGuests}
          friendsById={friendsById}
          onCancel={() => setMergingGuests(null)}
          onConfirm={commitGuestMerge}
        />
      )}

      {/* A guest with a Friends contact opens that contact's own pop-up — the
          fields you'd see on the Friends tab — with the wedding-only fields in
          a box at the top of its right column. One Save writes both. */}
      {editing?.viaFriend && (
        <FriendsPage
          key={editing.id}
          embed={{
            friendId: editing.draft.friendId,
            onClose: closeContact,
            onMissing: () => setEditing((e) => (e ? { ...e, viaFriend: false } : e)),
            onSaved: saveGuestFromFriend,
            onDelete: deleteContact,
            extra: (
              <div className={styles.friendWeddingBox}>
                <div className={styles.friendWeddingTitle}>💒 Wedding</div>
                <div className={styles.contactGrid}>
                  {WEDDING_ONLY_FIELDS.map(renderDraftField)}
                </div>
                {renderPartyPanel()}
                {draftDatalists}
              </div>
            ),
          }}
        />
      )}

      {editing && !editing.viaFriend && (
        <div className={styles.contactOverlay} onClick={closeContact}>
          <form
            className={styles.contactModal}
            role="dialog"
            aria-modal="true"
            aria-label={editing.id === null ? 'New guest' : 'Edit contact'}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); saveContact(); }}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {`${editing.draft.firstName} ${editing.draft.lastName}`.trim() || (editing.id === null ? 'New guest' : 'Contact')}
              </h2>
              <button className={styles.modalClose} type="button" onClick={closeContact} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              {(editing.draft.phone || editing.draft.email) && (
                <div className={styles.contactActions}>
                  {editing.draft.phone && (
                    <a className={styles.modalSecondary} href={`tel:${editing.draft.phone.replace(/[^+\d]/g, '')}`}>Call</a>
                  )}
                  {editing.draft.phone && (
                    <a className={styles.modalSecondary} href={`sms:${editing.draft.phone.replace(/[^+\d]/g, '')}`}>Text</a>
                  )}
                  {editing.draft.email && (
                    <a className={styles.modalSecondary} href={`mailto:${editing.draft.email}`}>Email</a>
                  )}
                </div>
              )}
              <div className={styles.contactGrid}>
                {CONTACT_FORM_FIELDS.map(renderDraftField)}
                <label className={`${styles.contactField} ${styles.contactWide}`}>
                  <span className={styles.contactLabel}>Friend</span>
                  <select className={styles.contactInput} value={editing.draft.friendId} onChange={(e) => setDraftField('friendId', e.target.value)}>
                    <option value="">{editing.id === null ? '— Add to Friends —' : '— None —'}</option>
                    {editing.draft.friendId && !friendsById.has(editing.draft.friendId) && (
                      <option value={editing.draft.friendId} disabled>(missing friend)</option>
                    )}
                    {friendsSorted.map((f) => (
                      <option key={f.id} value={f.id}>{f.name || f.email || f.id}</option>
                    ))}
                  </select>
                </label>
              </div>
              {renderPartyPanel()}
              {draftDatalists}
            </div>
            <div className={styles.modalFooter}>
              {editing.id !== null && (
                <button className={styles.bulkDelete} type="button" onClick={deleteContact}>Delete</button>
              )}
              <span className={styles.modalCount}>
                {editing.id === null && !editing.draft.friendId ? 'Also added to Friends (or linked if already there)' : ''}
              </span>
              {editing.id === null ? (
                <>
                  <button className={styles.modalSecondary} type="button" onClick={() => setEditing(null)}>Cancel</button>
                  <button className={styles.modalPrimary} type="submit">Add guest</button>
                </>
              ) : (
                <>
                  <span className={styles.modalCount}>Changes save automatically</span>
                  <button className={styles.modalPrimary} type="submit">Done</button>
                </>
              )}
            </div>
          </form>
        </div>
      )}

      {categoryEditor && (
        <div className={styles.contactOverlay} onClick={() => setCategoryEditor(null)}>
          <form
            className={styles.contactModal}
            role="dialog"
            aria-modal="true"
            aria-label="Edit categories"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); saveCategoryEditor(); }}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Edit categories</h2>
              <button className={styles.modalClose} type="button" onClick={() => setCategoryEditor(null)} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Renaming a category renames it for everyone in it. Give two categories the same name to merge them. Delete removes a category from the dropdowns and tabs and clears it off its guests.
              </p>
              {categoryEditor.length === 0 && <p className={styles.modalHint}>No categories yet — add one with + Category.</p>}
              {categoryEditor.map((r, i) => (r.deleted ? (
                <div key={r.from} className={`${styles.groupEditRow} ${styles.groupEditRowDeleted}`}>
                  <span className={styles.groupDeletedNote}>
                    <s>{r.from}</s> will be deleted
                    {r.count > 0 && ` — ${r.count} ${r.count === 1 ? 'guest goes' : 'guests go'} back to no category`}
                  </span>
                  <button className={styles.groupUndo} type="button" onClick={() => setCategoryRow(i, 'deleted', false)}>Undo</button>
                </div>
              ) : (
                <div key={r.from} className={`${styles.groupEditRow} ${styles.categoryEditRow}`}>
                  <label className={styles.contactField}>
                    <span className={styles.contactLabel}>
                      {r.from}{' · '}{r.count} {r.count === 1 ? 'guest' : 'guests'}
                    </span>
                    <input
                      className={styles.contactInput}
                      aria-label={`Name for ${r.from}`}
                      value={r.name}
                      onChange={(e) => setCategoryRow(i, 'name', e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <button
                    className={styles.groupDelete}
                    type="button"
                    onClick={() => setCategoryRow(i, 'deleted', true)}
                    aria-label={`Delete category ${r.from}`}
                    title="Delete this category"
                  >Delete</button>
                </div>
              )))}
            </div>
            <div className={styles.modalFooter}>
              <span className={styles.modalCount} />
              <button className={styles.modalSecondary} type="button" onClick={() => setCategoryEditor(null)}>Cancel</button>
              <button className={styles.modalPrimary} type="submit">Save</button>
            </div>
          </form>
        </div>
      )}

      {groupEditor && (
        <div className={styles.contactOverlay} onClick={() => setGroupEditor(null)}>
          <form
            className={styles.contactModal}
            role="dialog"
            aria-modal="true"
            aria-label="Edit groups"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); saveGroupEditor(); }}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Edit groups</h2>
              <button className={styles.modalClose} type="button" onClick={() => setGroupEditor(null)} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Renaming a group renames it for everyone in it. Give two groups the same name to merge them. Delete removes a group from the dropdowns and clears it off its guests.
              </p>
              {groupEditor.length === 0 && <p className={styles.modalHint}>No groups yet — add one with + Group.</p>}
              {groupEditor.map((r, i) => (r.deleted ? (
                <div key={r.from} className={`${styles.groupEditRow} ${styles.groupEditRowDeleted}`}>
                  <span className={styles.groupDeletedNote}>
                    <s>{r.from}</s> will be deleted
                    {r.count > 0 && ` — ${r.count} ${r.count === 1 ? 'guest goes' : 'guests go'} back to no group`}
                  </span>
                  <button className={styles.groupUndo} type="button" onClick={() => setGroupRow(i, 'deleted', false)}>Undo</button>
                </div>
              ) : (
                <div key={r.from} className={styles.groupEditRow}>
                  <label className={styles.contactField}>
                    <span className={styles.contactLabel}>
                      {r.from}{' · '}{r.count} {r.count === 1 ? 'guest' : 'guests'}
                    </span>
                    <input
                      className={styles.contactInput}
                      aria-label={`Name for ${r.from}`}
                      value={r.name}
                      onChange={(e) => setGroupRow(i, 'name', e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className={styles.contactField}>
                    <span className={styles.contactLabel}>Description</span>
                    <input
                      className={styles.contactInput}
                      aria-label={`Description for ${r.from}`}
                      value={r.desc}
                      placeholder="Shown in the tier legend"
                      onChange={(e) => setGroupRow(i, 'desc', e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <button
                    className={styles.groupDelete}
                    type="button"
                    onClick={() => setGroupRow(i, 'deleted', true)}
                    aria-label={`Delete group ${r.from}`}
                    title="Delete this group"
                  >Delete</button>
                </div>
              )))}
            </div>
            <div className={styles.modalFooter}>
              <span className={styles.modalCount} />
              <button className={styles.modalSecondary} type="button" onClick={() => setGroupEditor(null)}>Cancel</button>
              <button className={styles.modalPrimary} type="submit">Save</button>
            </div>
          </form>
        </div>
      )}

      {importOpen && (
        <div className={styles.modalOverlay} onClick={closeImport}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Paste from a spreadsheet</h2>
              <button className={styles.modalClose} type="button" onClick={closeImport} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Copy a range of cells from Google Sheets or Excel and paste below. Guests already on the list are
                matched by email, phone or full name and have their missing details filled in; everyone else is
                added as a new guest.
              </p>
              <textarea
                className={styles.modalTextarea}
                value={importText}
                onChange={(e) => handleImportTextChange(e.target.value)}
                placeholder={'Paste here — e.g.\nFirst\tLast\tEmail\tPhone\nJane\tDoe\tjane@example.com\t(555) 123-4567'}
                rows={6}
                autoFocus
              />
              {importRows.length > 0 && importColCount > 0 && (
                <>
                  <label className={styles.modalCheckRow}>
                    <input
                      type="checkbox"
                      checked={importHasHeader}
                      onChange={(e) => setImportHasHeader(e.target.checked)}
                    />
                    First row is a header
                  </label>
                  <div className={styles.mapScroll}>
                    <table className={styles.mapTable}>
                      <thead>
                        <tr>
                          {Array.from({ length: importColCount }).map((_, ci) => (
                            <th key={ci}>
                              <select
                                className={styles.mapSelect}
                                value={importMappings[ci] || ''}
                                onChange={(e) => setImportMapping(ci, e.target.value)}
                              >
                                {IMPORT_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>{f.label}</option>
                                ))}
                              </select>
                            </th>
                          ))}
                        </tr>
                        {importHasHeader && importRows[0] && (
                          <tr>
                            {Array.from({ length: importColCount }).map((_, ci) => (
                              <th key={ci} className={styles.mapHeaderCell}>{importRows[0][ci] || ''}</th>
                            ))}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {importPreviewRows.slice(0, 5).map((row, ri) => (
                          <tr key={ri}>
                            {Array.from({ length: importColCount }).map((_, ci) => (
                              <td key={ci}>{row[ci] || ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importPreviewRows.length > 5 && (
                    <div className={styles.modalHint}>…and {importPreviewRows.length - 5} more rows</div>
                  )}
                  <div className={styles.importMode} role="radiogroup" aria-label="Guests already on the list">
                    <span className={styles.importModeLabel}>Guests already on the list:</span>
                    <label className={styles.modalCheckRow}>
                      <input type="radio" name="importMode" checked={!importOverwrite} onChange={() => setImportOverwrite(false)} />
                      Only fill in empty fields
                    </label>
                    <label className={styles.modalCheckRow}>
                      <input type="radio" name="importMode" checked={importOverwrite} onChange={() => setImportOverwrite(true)} />
                      Replace with the pasted values
                    </label>
                  </div>
                  {importPlan && (
                    <div className={styles.importSummary} data-testid="import-summary">
                      <div className={styles.importSummaryCounts}>
                        <span><strong>{importPlan.added.length}</strong> new</span>
                        <span><strong>{importPlan.updated.length}</strong> updated</span>
                        <span><strong>{importPlan.unchanged}</strong> already up to date</span>
                        {importPlan.ambiguous.length > 0 && <span><strong>{importPlan.ambiguous.length}</strong> unclear</span>}
                        {importPlan.skipped > 0 && <span><strong>{importPlan.skipped}</strong> skipped (no name, email or phone)</span>}
                      </div>
                      {importPlan.updated.length > 0 && (
                        <ul className={styles.importChangeList}>
                          {importPlan.updated.slice(0, 8).map((u) => (
                            <li key={u.id}>
                              <strong>{u.name}</strong>: {u.fields.map((f) => FIELD_LABELS[f] || f).join(', ')}
                            </li>
                          ))}
                          {importPlan.updated.length > 8 && <li>…and {importPlan.updated.length - 8} more</li>}
                        </ul>
                      )}
                      {importPlan.ambiguous.length > 0 && (
                        <p className={styles.modalHint}>
                          Left alone because they match more than one guest:{' '}
                          {importPlan.ambiguous.slice(0, 6).map((a) => a.name).join(', ')}
                          {importPlan.ambiguous.length > 6 ? '…' : ''}. Add an email or phone column to tell them apart.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className={styles.modalFooter}>
              <span className={styles.modalCount}>
                {!importPlan ? 'Paste data to begin' : importChangeCount > 0 ? `${importChangeCount} ${importChangeCount === 1 ? 'guest' : 'guests'} to add or update` : 'Nothing new to add'}
              </span>
              <button className={styles.modalSecondary} type="button" onClick={closeImport}>Cancel</button>
              <button
                className={styles.modalPrimary}
                type="button"
                onClick={performImport}
                disabled={importChangeCount === 0}
              >
                {importPlan && importPlan.updated.length > 0 ? 'Add & update' : 'Import'} {importChangeCount > 0 ? importChangeCount : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.tableWrap}>
        <div className={styles.tableScroll}>
          <table className={styles.table} style={{ tableLayout: 'fixed', width: totalWidth, ...outlineVars }}>
            <colgroup>
              <col style={{ width: 36 }} />
              {visibleColumns.map((col) => (
                <col key={col.key} style={{ width: widthFor(col.key) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={styles.checkCell}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                    onChange={toggleSelectAllVisible}
                  />
                </th>
                {visibleColumns.map((col) => (
                  <th key={col.key} className={styles.resizable} onClick={() => setSort(col.key)}>
                    <span className={styles.thLabel}>
                      {col.label}
                      {sortKey === col.key && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </span>
                    <span
                      className={styles.resizer}
                      onMouseDown={(e) => startResize(e, col.key)}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to resize"
                    />
                  </th>
                ))}
              </tr>
              <tr className={styles.filterRow}>
                <th className={styles.checkCell} />
                {visibleColumns.map((col) => (
                  <th key={col.key} className={styles.filterCell} onClick={(e) => e.stopPropagation()}>
                    {renderFilterCell(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={visibleColumns.length + 1} className={styles.loadingState}>Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={visibleColumns.length + 1} className={styles.empty}>
                  {/* An empty Not categorized tab is the goal, not a failed filter. */}
                  {activeCategoryTab === UNSORTED && !search.trim() && contacts.length > 0
                    && Object.keys(columnFilters).every((k) => k === 'category' || !columnFilters[k])
                    ? 'Everyone has a category. Pick a tab above to see them.'
                    : 'No contacts match.'}
                </td></tr>
              )}
              {!loading && filtered.map((c) => (
                <tr
                  key={c.id}
                  className={[
                    STATUS_CLASS[c.status] ? styles[STATUS_CLASS[c.status]] : '',
                    !hiddenOutlines.group && outlines.get(c.id)?.group ? `${styles.groupBox} ${styles[`groupBox_${outlines.get(c.id).group}`]}` : '',
                    !hiddenOutlines.couple && outlines.get(c.id)?.couple ? `${styles.coupleBox} ${styles[`coupleBox_${outlines.get(c.id).couple}`]}` : '',
                  ].filter(Boolean).join(' ') || undefined}
                >
                  <td className={styles.checkCell}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelected(c.id)}
                    />
                  </td>
                  {visibleColumns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        col.key === 'name' ? styles.nameCell : '',
                        (col.key === 'phone' || col.key === 'zip') ? styles.mono : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {col.key === 'group' ? (
                        <select
                          className={styles.cellSelect}
                          value={c.group || ''}
                          onChange={(e) => handleRowGroupChange(c.id, e.target.value)}
                          title={groupDescription(c.group) || undefined}
                        >
                          <option value="">— None —</option>
                          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                          <option value={NEW_GROUP_SENTINEL}>+ New group…</option>
                        </select>
                      ) : col.key === 'category' ? (
                        <select
                          className={styles.cellSelect}
                          value={c.category || ''}
                          onChange={(e) => handleRowCategoryChange(c.id, e.target.value)}
                        >
                          <option value="">— None —</option>
                          {categories.map((g) => <option key={g} value={g}>{g}</option>)}
                          <option value={NEW_CATEGORY_SENTINEL}>+ New category…</option>
                        </select>
                      ) : col.key === 'subcategory' ? (() => {
                        const subs = subcategoriesFor(c.category);
                        return (
                          <select
                            className={styles.cellSelect}
                            value={c.subcategory || ''}
                            onChange={(e) => handleRowSubcategoryChange(c.id, e.target.value)}
                            disabled={!c.category}
                            title={c.category ? `A subcategory of ${c.category}` : 'Pick a category first'}
                            aria-label={`Subcategory for ${`${c.firstName || ''} ${c.lastName || ''}`.trim()}`}
                          >
                            <option value="">— None —</option>
                            {c.subcategory && !subs.includes(c.subcategory) && <option value={c.subcategory}>{c.subcategory}</option>}
                            {subs.map((g) => <option key={g} value={g}>{g}</option>)}
                            <option value={NEW_SUBCATEGORY_SENTINEL}>+ New subcategory…</option>
                          </select>
                        );
                      })() : col.key === 'status' ? (
                        <select
                          className={`${styles.cellSelect} ${styles.statusSelect}`}
                          value={c.status || ''}
                          onChange={(e) => handleRowStatusChange(c.id, e.target.value)}
                        >
                          <option value="">— None —</option>
                          {STATUS_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      ) : col.key === 'side' ? (
                        <select
                          className={styles.cellSelect}
                          value={c.side || ''}
                          onChange={(e) => handleRowSideChange(c.id, e.target.value)}
                          aria-label={`Side of the family for ${`${c.firstName || ''} ${c.lastName || ''}`.trim()}`}
                        >
                          <option value="">— None —</option>
                          {sides.map((g) => <option key={g} value={g}>{g}</option>)}
                          <option value={NEW_SIDE_SENTINEL}>+ New side…</option>
                        </select>
                      ) : col.key === 'party' ? (
                        <WeddingPartyCell
                          value={c.party || ''}
                          parties={parties}
                          onCommit={(v) => handleRowPartyChange(c.id, v).catch((err) => console.error('Saving wedding group failed:', err))}
                          label={`Wedding group for ${`${c.firstName || ''} ${c.lastName || ''}`.trim()}`}
                        />
                      ) : col.key === 'guestOf' ? (
                        <select
                          className={styles.cellSelect}
                          value={c.guestOf || ''}
                          onChange={(e) => handleRowGuestOfChange(c.id, e.target.value)}
                        >
                          <option value="">— None —</option>
                          {GUEST_OF_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      ) : col.key === 'friend' ? (
                        <select
                          className={styles.cellSelect}
                          value={c.friendId && friendsById.has(c.friendId) ? c.friendId : ''}
                          onChange={(e) => handleRowFriendChange(c.id, e.target.value)}
                        >
                          <option value="">— None —</option>
                          {c.friendId && !friendsById.has(c.friendId) && (
                            <option value={c.friendId} disabled>(missing friend)</option>
                          )}
                          {friendsSorted.map((f) => (
                            <option key={f.id} value={f.id}>{f.name || f.email || f.id}</option>
                          ))}
                        </select>
                      ) : col.key === 'name' ? (
                        <button
                          type="button"
                          className={styles.nameButton}
                          onClick={() => openContact(c)}
                          title="Edit contact"
                        >{`${c.firstName || ''} ${c.lastName || ''}`.trim() || '(no name)'}</button>
                      ) : renderCell(col, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* Wedding is two things: who is coming, and what still has to be done.

   They share a tab because they are the same project, and they sit on subtabs
   rather than one long page because you open the page for one or the other,
   never both. The choice rides in the URL the way Plans does it, so a link to
   the checklist is a link to the checklist. */
export function WeddingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get('view');
  const view = ['checklist', 'timeline', 'venues', 'friends'].includes(rawView) ? rawView : 'guests';
  const setView = (v) => setSearchParams(v === 'guests' ? {} : { view: v });

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  return (
    <>
      <div className={styles.subtabBar}>
        <div className={styles.subtabInner}>
          <button
            type="button"
            className={view === 'guests' ? styles.subtabActive : styles.subtab}
            onClick={() => setView('guests')}
          >Guest List</button>
          <button
            type="button"
            className={view === 'checklist' ? styles.subtabActive : styles.subtab}
            onClick={() => setView('checklist')}
          >Checklist</button>
          <button
            type="button"
            className={view === 'timeline' ? styles.subtabActive : styles.subtab}
            onClick={() => setView('timeline')}
          >Timeline</button>
          <button
            type="button"
            className={view === 'venues' ? styles.subtabActive : styles.subtab}
            onClick={() => setView('venues')}
          >Venues</button>
          <button
            type="button"
            className={view === 'friends' ? styles.subtabActive : styles.subtab}
            onClick={() => setView('friends')}
          >Friends not on list</button>
        </div>
      </div>
      {view === 'friends' ? <WeddingFriendsNotInvited /> : view === 'venues' ? <WeddingVenues /> : view === 'timeline' ? (
        <div className={styles.page}>
          <div className={styles.header}>
            <h1 className={styles.title}>Wedding</h1>
          </div>
          <p className={styles.subtitle}>The plan on real dates, from booking the venue to the last thank-you note.</p>
          <WeddingTimeline />
        </div>
      ) : view === 'checklist' ? (
        <div className={styles.page}>
          <div className={styles.header}>
            <h1 className={styles.title}>Wedding</h1>
          </div>
          <p className={styles.subtitle}>Everything that has to happen, counting backward from the date.</p>
          <WeddingChecklist />
        </div>
      ) : <GuestList />}
    </>
  );
}
