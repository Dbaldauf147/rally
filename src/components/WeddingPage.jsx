import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import styles from './WeddingPage.module.css';

const CONTACTS = [
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

const COLUMNS = [
  { key: 'name', label: 'Name', sortBy: (c) => `${c.lastName} ${c.firstName}`.toLowerCase() },
  { key: 'email', label: 'Email', sortBy: (c) => (c.email || '').toLowerCase() },
  { key: 'phone', label: 'Phone', sortBy: (c) => c.phone || '' },
  { key: 'address', label: 'Address', sortBy: (c) => (c.address || '').toLowerCase() },
  { key: 'city', label: 'City', sortBy: (c) => (c.city || '').toLowerCase() },
  { key: 'state', label: 'State', sortBy: (c) => (c.state || '').toLowerCase() },
  { key: 'zip', label: 'Zip', sortBy: (c) => c.zip || '' },
];

export function WeddingPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const states = useMemo(() => {
    const set = new Set(CONTACTS.map((c) => c.state).filter(Boolean));
    return Array.from(set).sort();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = CONTACTS;
    if (stateFilter) rows = rows.filter((c) => c.state === stateFilter);
    if (q) {
      rows = rows.filter((c) => {
        const hay = `${c.firstName} ${c.lastName} ${c.email} ${c.phone} ${c.address} ${c.city} ${c.state} ${c.zip}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const col = COLUMNS.find((c) => c.key === sortKey) || COLUMNS[0];
    const sorted = [...rows].sort((a, b) => {
      const av = col.sortBy(a);
      const bv = col.sortBy(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [search, stateFilter, sortKey, sortDir]);

  if (user?.email !== 'baldaufdan@gmail.com') return <Navigate to="/" replace />;

  const setSort = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Wedding</h1>
        <div className={styles.count}>{filtered.length} of {CONTACTS.length} contacts</div>
      </div>
      <p className={styles.subtitle}>Guest contact list.</p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search by name, email, address, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={styles.select} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
          <option value="">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className={styles.tableWrap}>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} onClick={() => setSort(col.key)}>
                    {col.label}
                    {sortKey === col.key && <span className={styles.sortArrow}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className={styles.empty}>No contacts match.</td></tr>
              )}
              {filtered.map((c, i) => (
                <tr key={`${c.lastName}-${c.firstName}-${c.address}-${i}`}>
                  <td className={styles.nameCell}>{c.firstName} {c.lastName}</td>
                  <td>{c.email ? <a className={styles.link} href={`mailto:${c.email}`}>{c.email}</a> : <span className={styles.muted}>—</span>}</td>
                  <td className={styles.mono}>{c.phone ? <a className={styles.link} href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a> : <span className={styles.muted}>—</span>}</td>
                  <td>{c.address}</td>
                  <td>{c.city}</td>
                  <td>{c.state}</td>
                  <td className={styles.mono}>{c.zip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
