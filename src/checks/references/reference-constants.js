const US_CITY_STATE = { 'New York': 'NY', 'Boca Raton': 'FL', 'Cambridge': 'MA', 'Boston': 'MA', 'Hoboken': 'NJ', 'Totowa': 'NJ', 'Piscataway': 'NJ', 'Englewood Cliffs': 'NJ', 'Upper Saddle River': 'NJ', 'Princeton': 'NJ', 'Washington': 'DC', 'San Diego': 'CA', 'San Francisco': 'CA', 'Los Angeles': 'CA', 'Thousand Oaks': 'CA', 'Berkeley': 'CA', 'Stanford': 'CA', 'Palo Alto': 'CA', 'Oakland': 'CA', 'Sebastopol': 'CA', 'Chicago': 'IL', 'Champaign': 'IL', 'Philadelphia': 'PA', 'Pittsburgh': 'PA', 'Waltham': 'MA', 'Burlington': 'MA', 'Norwood': 'MA', 'Amherst': 'MA', 'Sunderland': 'MA', 'Baltimore': 'MD', 'Bethesda': 'MD', 'Rockville': 'MD', 'Lanham': 'MD', 'Hershey': 'PA', 'Malden': 'MA', 'Oxford': 'MS', 'Ithaca': 'NY', 'Rochester': 'NY', 'Albany': 'NY', 'Hauppauge': 'NY', 'Clifton Park': 'NY', 'Ann Arbor': 'MI', 'Detroit': 'MI', 'Minneapolis': 'MN', 'St. Paul': 'MN', 'Saint Paul': 'MN', 'Madison': 'WI', 'Austin': 'TX', 'Houston': 'TX', 'Dallas': 'TX', 'College Station': 'TX', 'Atlanta': 'GA', 'Athens': 'GA', 'Seattle': 'WA', 'Portland': 'OR', 'Corvallis': 'OR', 'Denver': 'CO', 'Boulder': 'CO', 'Indianapolis': 'IN', 'West Lafayette': 'IN', 'Columbus': 'OH', 'Cleveland': 'OH', 'Cincinnati': 'OH', 'Nashville': 'TN', 'New Haven': 'CT', 'Hartford': 'CT', 'Gainesville': 'FL', 'Miami': 'FL', 'Orlando': 'FL', 'Raleigh': 'NC', 'Durham': 'NC', 'Chapel Hill': 'NC', 'Arlington': 'VA', 'Reston': 'VA', 'Alexandria': 'VA', 'Charlottesville': 'VA', 'Salt Lake City': 'UT', 'Phoenix': 'AZ', 'Tucson': 'AZ', 'Lincoln': 'NE', 'Lawrence': 'KS', 'Iowa City': 'IA', 'Ames': 'IA', 'St. Louis': 'MO', 'Saint Louis': 'MO', 'Kansas City': 'MO', 'New Orleans': 'LA', 'Honolulu': 'HI', 'Anchorage': 'AK', 'Toronto': 'ON', 'Ottawa': 'ON', 'Montreal': 'QC', 'Montréal': 'QC', 'Quebec': 'QC', 'Vancouver': 'BC', 'Victoria': 'BC', 'Calgary': 'AB', 'Edmonton': 'AB', 'Winnipeg': 'MB', 'Halifax': 'NS', 'Waterloo': 'ON', 'Hamilton': 'ON', 'London': 'ON' };
const FIXED_JABBR = [
  [/^(PNAS|Proc\.?\s*Natl\.?\s*Acad\.?\s*Sci\.?(\s*(U\.?\s*S\.?\s*A\.?|USA))?)$/, 'Proc. Natl. Acad. Sci. USA'],
  [/^J\.?\s*Power\s*Sour(ces|\.)$/, 'J. Power Sources'],
  [/^J\.?\s*Alloys?\.?\s*Compd?s?\.?$/, 'J. Alloys Compd.'],
  [/^Int\.?\s*J\.?\s*Hydrog(en|\.)\s*Energy$/, 'Int. J. Hydrogen Energy'],
  [/^Trans\.?\s*Nonferr(ous|\.)\s*Met(als|\.)?\s*Soc\.?\s*China$/, 'Trans. Nonferrous Met. Soc. China'],
  [/^Sports?\.?\s*Med\.?$/, 'Sports Med.'],
  [/^Glob(al|\.)\s*Chang(e|\.)\s*Biol\.?$/, 'Glob. Change Biol.'],
  [/^J\.?\s*Micromech(anics|\.)\s*Microeng(ineering|\.)$/, 'J. Micromech. Microeng.'],
  [/^Toxicol\.?\s*(In|in)\s*Vit(ro|r\.)$/, 'Toxicol. In Vitro']
];
const ABBR_VALUES = new Set(Object.values(ABBR_DICT).filter(Boolean).map(v => v.toLowerCase()));

