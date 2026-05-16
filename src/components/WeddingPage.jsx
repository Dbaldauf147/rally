import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import styles from './WeddingPage.module.css';

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

const ALL_COLUMNS = [
  { key: 'name', label: 'Name', defaultWidth: 180, sortBy: (c) => `${c.lastName || ''} ${c.firstName || ''}`.toLowerCase() },
  { key: 'group', label: 'Group', defaultWidth: 140, sortBy: (c) => (c.group || '').toLowerCase() },
  { key: 'guestOf', label: 'Guest Of', defaultWidth: 140, sortBy: (c) => (c.guestOf || '').toLowerCase() },
  { key: 'email', label: 'Email', defaultWidth: 220, sortBy: (c) => (c.email || '').toLowerCase() },
  { key: 'phone', label: 'Phone', defaultWidth: 140, sortBy: (c) => c.phone || '' },
  { key: 'address', label: 'Address', defaultWidth: 220, sortBy: (c) => (c.address || '').toLowerCase() },
  { key: 'city', label: 'City', defaultWidth: 140, sortBy: (c) => (c.city || '').toLowerCase() },
  { key: 'state', label: 'State', defaultWidth: 80, sortBy: (c) => (c.state || '').toLowerCase() },
  { key: 'zip', label: 'Zip', defaultWidth: 90, sortBy: (c) => c.zip || '' },
];

const DEFAULT_VISIBLE = ['name', 'group', 'guestOf', 'email', 'phone', 'city', 'state'];

const EDITABLE_FIELDS = [
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'group', label: 'Group' },
  { key: 'guestOf', label: 'Guest Of' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'Zip' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
];

const NEW_GROUP_SENTINEL = '__new_group__';
const SEED_FLAG_KEY = 'rally.weddingContacts.seeded';
const GUEST_OF_OPTIONS = ['Dan', 'Joanne'];

const IMPORT_FIELDS = [
  { key: '', label: '— Skip —' },
  { key: 'fullName', label: 'Full Name (auto-split)' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'Zip' },
  { key: 'group', label: 'Group' },
  { key: 'guestOf', label: 'Guest Of' },
];

const FIELD_PATTERNS = [
  { key: 'firstName', patterns: [/^first\s*(name)?$/i, /^fname$/i, /^given/i] },
  { key: 'lastName', patterns: [/^last\s*(name)?$/i, /^lname$/i, /^surname$/i, /^family/i] },
  { key: 'fullName', patterns: [/^(full\s*)?name$/i, /^contact$/i] },
  { key: 'email', patterns: [/^e[-\s]?mail/i] },
  { key: 'phone', patterns: [/^phone/i, /^mobile/i, /^cell/i, /^tel/i, /number/i] },
  { key: 'address', patterns: [/^address/i, /^street/i, /^addr/i] },
  { key: 'city', patterns: [/^city$/i, /^town$/i] },
  { key: 'state', patterns: [/^state/i, /^province/i, /^region/i] },
  { key: 'zip', patterns: [/^zip/i, /^postal/i, /^post\s*code$/i] },
  { key: 'group', patterns: [/^group/i, /^category/i, /^tag/i] },
  { key: 'guestOf', patterns: [/^guest\s*of/i, /^plus\s*one/i, /^\+1$/i] },
];

function parseTSV(text) {
  if (!text) return [];
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

function autoDetectMappings(headerRow) {
  return headerRow.map((h) => {
    const cleaned = (h || '').trim();
    if (!cleaned) return '';
    for (const f of FIELD_PATTERNS) {
      if (f.patterns.some((re) => re.test(cleaned))) return f.key;
    }
    return '';
  });
}

function buildImportedContacts(rows, mappings, hasHeader) {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const now = Date.now();
  return dataRows
    .map((row, i) => {
      const c = { id: `import-${now}-${i}-${Math.random().toString(36).slice(2, 8)}` };
      mappings.forEach((field, colIdx) => {
        if (!field) return;
        const val = (row[colIdx] || '').trim();
        if (field === 'fullName') {
          const parts = val.split(/\s+/);
          c.firstName = parts[0] || c.firstName || '';
          c.lastName = parts.slice(1).join(' ') || c.lastName || '';
        } else {
          c[field] = val;
        }
      });
      return c;
    })
    .filter((c) => c.firstName || c.lastName || c.email || c.phone);
}

function renderCell(col, c) {
  switch (col.key) {
    case 'name': return <>{c.firstName} {c.lastName}</>;
    case 'group': return c.group ? <span className={styles.groupBadge}>{c.group}</span> : <span className={styles.muted}>—</span>;
    case 'guestOf': return c.guestOf || <span className={styles.muted}>—</span>;
    case 'email': return c.email ? <a className={styles.link} href={`mailto:${c.email}`}>{c.email}</a> : <span className={styles.muted}>—</span>;
    case 'phone': return c.phone ? <a className={styles.link} href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a> : <span className={styles.muted}>—</span>;
    case 'address': return c.address || <span className={styles.muted}>—</span>;
    case 'city': return c.city || <span className={styles.muted}>—</span>;
    case 'state': return c.state || <span className={styles.muted}>—</span>;
    case 'zip': return c.zip || <span className={styles.muted}>—</span>;
    default: return null;
  }
}

export function WeddingPage() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [savedGroups, setSavedGroups] = useState([]);
  const [columnConfig, setColumnConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkField, setBulkField] = useState('group');
  const [bulkValue, setBulkValue] = useState('');
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importHasHeader, setImportHasHeader] = useState(true);
  const [importMappings, setImportMappings] = useState([]);
  const seedAttempted = useRef(false);
  const columnsMenuRef = useRef(null);
  const columnConfigRef = useRef({});
  const dragRef = useRef(null);

  useEffect(() => { columnConfigRef.current = columnConfig; }, [columnConfig]);

  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setSavedGroups(Array.isArray(data.weddingGroups) ? data.weddingGroups : []);
        setColumnConfig(data.weddingColumnConfig && typeof data.weddingColumnConfig === 'object' ? data.weddingColumnConfig : {});
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

  const persistContacts = async (next) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { weddingContacts: next }, { merge: true });
  };

  const persistGroups = async (next) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { weddingGroups: next }, { merge: true });
  };

  const persistColumnConfig = async (next) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { weddingColumnConfig: next }, { merge: true });
  };

  const groups = useMemo(() => {
    const set = new Set(savedGroups.filter(Boolean));
    contacts.forEach((c) => { if (c.group) set.add(c.group); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [contacts, savedGroups]);

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

  const importRows = useMemo(() => parseTSV(importText), [importText]);
  const importableCount = useMemo(
    () => (importRows.length === 0 ? 0 : buildImportedContacts(importRows, importMappings, importHasHeader).length),
    [importRows, importMappings, importHasHeader],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = contacts;
    if (stateFilter) rows = rows.filter((c) => c.state === stateFilter);
    if (groupFilter === '__none__') rows = rows.filter((c) => !c.group);
    else if (groupFilter) rows = rows.filter((c) => c.group === groupFilter);
    if (q) {
      rows = rows.filter((c) => {
        const hay = `${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${c.phone || ''} ${c.address || ''} ${c.city || ''} ${c.state || ''} ${c.zip || ''} ${c.group || ''} ${c.guestOf || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const col = ALL_COLUMNS.find((c) => c.key === sortKey) || ALL_COLUMNS[0];
    const sorted = [...rows].sort((a, b) => {
      const av = col.sortBy(a);
      const bv = col.sortBy(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [contacts, search, stateFilter, groupFilter, sortKey, sortDir]);

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  const setSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
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

  const applyBulkEdit = async () => {
    if (!user || selected.size === 0) return;
    const next = contacts.map((c) => (selected.has(c.id) ? { ...c, [bulkField]: bulkValue } : c));
    await persistContacts(next);
    setBulkValue('');
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

  const handleRowGuestOfChange = async (id, val) => {
    const next = contacts.map((c) => (c.id === id ? { ...c, guestOf: val } : c));
    await persistContacts(next);
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
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const totalWidth = 36 + visibleColumns.reduce((sum, col) => sum + widthFor(col.key), 0);
  const importColCount = importRows.reduce((m, r) => Math.max(m, r.length), 0);
  const importPreviewRows = importHasHeader ? importRows.slice(1) : importRows;

  const openImport = () => {
    setImportOpen(true);
    setImportText('');
    setImportHasHeader(true);
    setImportMappings([]);
  };
  const closeImport = () => setImportOpen(false);

  const handleImportTextChange = (val) => {
    setImportText(val);
    const rows = parseTSV(val);
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (rows.length === 0 || cols === 0) {
      setImportMappings([]);
      return;
    }
    const header = rows[0] || [];
    const detected = autoDetectMappings(header);
    const filled = Array.from({ length: cols }, (_, i) => detected[i] || '');
    setImportMappings(filled);
    const looksLikeHeader = header.some((h) => /[a-z]/i.test(h || '')) && detected.some(Boolean);
    setImportHasHeader(looksLikeHeader);
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
    const newContacts = buildImportedContacts(importRows, importMappings, importHasHeader);
    if (newContacts.length === 0) return;
    const next = [...contacts, ...newContacts];
    await persistContacts(next);
    setImportOpen(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        <div className={styles.count}>{filtered.length} of {contacts.length} contacts</div>
      </div>
      <p className={styles.subtitle}>Guest contact list. Select rows to bulk-edit a field.</p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search by name, email, address, group…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={styles.select} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
          <option value="">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={styles.select} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="">All groups</option>
          <option value="__none__">No group</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button className={styles.toolButton} type="button" onClick={createGroup}>+ Group</button>
        <button className={styles.toolButton} type="button" onClick={openImport}>+ Import</button>
        <div className={styles.colMenu} ref={columnsMenuRef}>
          <button className={styles.toolButton} type="button" onClick={() => setShowColumnsMenu((s) => !s)}>
            Columns ▾
          </button>
          {showColumnsMenu && (
            <div className={styles.colMenuPopover}>
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
          ) : bulkField === 'guestOf' ? (
            <select className={styles.bulkInput} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">— (clear)</option>
              {GUEST_OF_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
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
          <button className={styles.bulkDelete} onClick={deleteSelected}>Delete</button>
          <button className={styles.bulkClear} onClick={clearSelection}>Clear</button>
        </div>
      )}

      {importOpen && (
        <div className={styles.modalOverlay} onClick={closeImport}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Import contacts</h2>
              <button className={styles.modalClose} type="button" onClick={closeImport} aria-label="Close">×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Copy a range of cells from Google Sheets (or Excel) and paste below. Columns will be tab-separated automatically.
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
                </>
              )}
            </div>
            <div className={styles.modalFooter}>
              <span className={styles.modalCount}>
                {importableCount > 0 ? `${importableCount} contact${importableCount === 1 ? '' : 's'} ready to import` : 'Paste data to begin'}
              </span>
              <button className={styles.modalSecondary} type="button" onClick={closeImport}>Cancel</button>
              <button
                className={styles.modalPrimary}
                type="button"
                onClick={performImport}
                disabled={importableCount === 0}
              >
                Import {importableCount > 0 ? importableCount : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.tableWrap}>
        <div className={styles.tableScroll}>
          <table className={styles.table} style={{ tableLayout: 'fixed', width: totalWidth }}>
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
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={visibleColumns.length + 1} className={styles.loadingState}>Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={visibleColumns.length + 1} className={styles.empty}>No contacts match.</td></tr>
              )}
              {!loading && filtered.map((c) => (
                <tr key={c.id}>
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
                        >
                          <option value="">— None —</option>
                          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                          <option value={NEW_GROUP_SENTINEL}>+ New group…</option>
                        </select>
                      ) : col.key === 'guestOf' ? (
                        <select
                          className={styles.cellSelect}
                          value={c.guestOf || ''}
                          onChange={(e) => handleRowGuestOfChange(c.id, e.target.value)}
                        >
                          <option value="">— None —</option>
                          {GUEST_OF_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
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
