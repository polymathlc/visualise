// Copied from polymathlc/math index.html (MOE Primary Mathematics Syllabus 2021, standard).
// LO ids <level>.<sub-strand key>.<code> match the Maths app, e.g. P3.WN.2.1. Append, never renumber.
export const MOE_SYLLABUS = [
  // ───────────────────────────── P1 ─────────────────────────────
  { lv: "P1", strands: [
    { s: "Number and Algebra", subs: [
      { k: "WN", n: "Whole Numbers", topics: [
        { t: "Numbers up to 100", los: [
          ["1.1", "counting to tell the number of objects in a given set"],
          ["1.2", "number notation, representations and place values (tens, ones)"],
          ["1.3", "reading and writing numbers in numerals and in words"],
          ["1.4", "comparing the number of objects in two or more sets"],
          ["1.5", "comparing and ordering numbers"],
          ["1.6", "patterns in number sequences"],
          ["1.7", "ordinal numbers (first, second, up to tenth) and symbols (1st, 2nd, 3rd, etc)"],
          ["1.8", "number bonds for numbers up to 10"]
        ] },
        { t: "Addition and Subtraction", los: [
          ["2.1", "concepts of addition and subtraction"],
          ["2.2", "use of +, – and ="],
          ["2.3", "relationship between addition and subtraction"],
          ["2.4", "adding more than two 1-digit numbers"],
          ["2.5", "adding and subtracting within 100"],
          ["2.6", "adding and subtracting using algorithms"],
          ["2.7", "solving 1-step word problems involving addition and subtraction within 20"],
          ["2.8", "mental calculation involving addition and subtraction", ["within 20", "of a 2-digit number and ones without renaming", "of a 2-digit number and tens"]]
        ] },
        { t: "Multiplication and Division", los: [
          ["3.1", "concepts of multiplication and division"],
          ["3.2", "use of ×"],
          ["3.3", "multiplying within 40"],
          ["3.4", "dividing within 20"],
          ["3.5", "solving 1-step word problems involving multiplication and division with pictorial representation"]
        ] }
      ] },
      { k: "MON", n: "Money", topics: [
        { t: "Money", los: [
          ["1.1", "counting amount of money", ["in cents up to $1", "in dollars up to $100"]],
          ["1.2", "solving 1-step word problems involving addition and subtraction of money in dollars only (or in cents only)"]
        ] }
      ] }
    ] },
    { s: "Measurement and Geometry", subs: [
      { k: "MEA", n: "Measurement", topics: [
        { t: "Length", los: [
          ["1.1", "measuring and comparing the length of objects in non-standard units"]
        ] },
        { t: "Time", los: [
          ["2.1", "telling time to the hour/half hour"]
        ] }
      ] },
      { k: "GEO", n: "Geometry", topics: [
        { t: "2D Shapes", los: [
          ["1.1", "identifying, naming, describing and classifying 2D shapes", ["rectangle", "square", "circle", "triangle"]],
          ["1.2", "making/completing patterns with 2D shapes according to one or two of the following attributes", ["size", "shape", "colour", "orientation"]]
        ] }
      ] }
    ] },
    { s: "Statistics", subs: [
      { k: "DRI", n: "Data Representation and Interpretation", topics: [
        { t: "Picture Graphs", los: [
          ["1.1", "reading and interpreting data from picture graphs"]
        ] }
      ] }
    ] }
  ] },
  // ───────────────────────────── P2 ─────────────────────────────
  { lv: "P2", strands: [
    { s: "Number and Algebra", subs: [
      { k: "WN", n: "Whole Numbers", topics: [
        { t: "Numbers up to 1000", los: [
          ["1.1", "counting in tens/hundreds"],
          ["1.2", "number notation, representations and place values (hundreds, tens, ones)"],
          ["1.3", "reading and writing numbers in numerals and in words"],
          ["1.4", "comparing and ordering numbers"],
          ["1.5", "patterns in number sequences"],
          ["1.6", "odd and even numbers"]
        ] },
        { t: "Addition and Subtraction", los: [
          ["2.1", "addition and subtraction algorithms (up to 3 digits)"],
          ["2.2", "solving up to 2-step word problems involving addition and subtraction"],
          ["2.3", "mental calculation involving addition and subtraction of a 3-digit number and ones/tens/ hundreds"]
        ] },
        { t: "Multiplication and Division", los: [
          ["3.1", "multiplication tables of 2, 3, 4, 5 and 10"],
          ["3.2", "use of ÷"],
          ["3.3", "relationship between multiplication and division"],
          ["3.4", "multiplying and dividing within the multiplication tables"],
          ["3.5", "solving 1-step word problems involving multiplication and division within the multiplication tables"],
          ["3.6", "mental calculation involving multiplication and division within the multiplication tables of 2, 3, 4, 5 and 10"]
        ] }
      ] },
      { k: "FR", n: "Fractions", topics: [
        { t: "Fraction of a Whole", los: [
          ["1.1", "fraction as part of a whole"],
          ["1.2", "notation and representations of fractions"],
          ["1.3", "comparing and ordering fractions with denominators of given fractions not exceeding 12", ["unit fractions", "like fractions"]]
        ] },
        { t: "Addition and Subtraction", los: [
          ["2.1", "adding and subtracting like fractions within one whole with denominators of given fractions not exceeding 12"]
        ] }
      ] },
      { k: "MON", n: "Money", topics: [
        { t: "Money", los: [
          ["1.1", "counting amount of money in dollars and cents"],
          ["1.2", "reading and writing money in decimal notation"],
          ["1.3", "comparing two or three amounts of money"],
          ["1.4", "converting an amount of money in decimal notation to cents only, and vice versa"],
          ["1.5", "solving word problems involving money in dollars only (or in cents only)"]
        ] }
      ] }
    ] },
    { s: "Measurement and Geometry", subs: [
      { k: "MEA", n: "Measurement", topics: [
        { t: "Length, Mass and Volume", los: [
          ["1.1", "measuring", ["length in metres/centimetres", "mass in kilograms/grams", "volume of liquid in litres"]],
          ["1.2", "measuring and drawing a line segment to the nearest cm"],
          ["1.3", "using appropriate units of measurement and their abbreviations cm, m, g, kg, ℓ"],
          ["1.4", "comparing and ordering", ["lengths", "masses", "volumes"]],
          ["1.5", "solving word problems involving length/mass/ volume"]
        ] },
        { t: "Time", los: [
          ["2.1", "telling time to 5 minutes"],
          ["2.2", "use of ‘a.m.’ and ‘p.m.’"],
          ["2.3", "use of abbreviations h and min"],
          ["2.4", "drawing hands on the clock face to show time"],
          ["2.5", "duration of 1 hour/half hour"]
        ] }
      ] },
      { k: "GEO", n: "Geometry", topics: [
        { t: "2D Shapes", los: [
          ["1.1", "identifying, naming and describing 2D shapes", ["semicircle", "quarter circle"]],
          ["1.2", "identifying the basic shapes that make up a given figure"],
          ["1.3", "forming different 2D figures with", ["rectangle", "square", "triangle", "semicircle", "quarter circle"]],
          ["1.4", "copying figures on dot grid or square grid"]
        ] },
        { t: "3D Shapes", los: [
          ["2.1", "identifying, naming, describing and classifying 3D shapes", ["cube", "cuboid", "cone", "cylinder", "sphere"]]
        ] }
      ] }
    ] },
    { s: "Statistics", subs: [
      { k: "DRI", n: "Data Representation and Interpretation", topics: [
        { t: "Picture Graphs with Scales", los: [
          ["1.1", "reading and interpreting data from picture graphs with scales"],
          ["1.2", "solving 1-step problems using data from picture graphs"]
        ] }
      ] }
    ] }
  ] },
  // ───────────────────────────── P3 ─────────────────────────────
  { lv: "P3", strands: [
    { s: "Number and Algebra", subs: [
      { k: "WN", n: "Whole Numbers", topics: [
        { t: "Numbers up to 10 000", los: [
          ["1.1", "counting in hundreds/thousands"],
          ["1.2", "number notation, representations and place values (thousands, hundreds, tens, ones)"],
          ["1.3", "reading and writing numbers in numerals and in words"],
          ["1.4", "comparing and ordering numbers"],
          ["1.5", "patterns in number sequences"]
        ] },
        { t: "Addition and Subtraction", los: [
          ["2.1", "addition and subtraction algorithms (up to 4 digits)"],
          ["2.2", "solving up to 2-step word problems involving addition and subtraction"],
          ["2.3", "mental calculation involving addition and subtraction of two 2-digit numbers"]
        ] },
        { t: "Multiplication and Division", los: [
          ["3.1", "multiplication tables of 6, 7, 8 and 9"],
          ["3.2", "multiplying and dividing within the multiplication tables"],
          ["3.3", "division with remainder"],
          ["3.4", "multiplication and division algorithms (up to 3 digits by 1 digit)"],
          ["3.5", "solving up to 2-step word problems involving the 4 operations"],
          ["3.6", "mental calculation involving multiplication and division within the multiplication tables"]
        ] }
      ] },
      { k: "FR", n: "Fractions", topics: [
        { t: "Equivalent fractions", los: [
          ["1.1", "equivalent fractions"],
          ["1.2", "expressing a fraction in its simplest form"],
          ["1.3", "comparing and ordering unlike fractions with denominators of given fractions not exceeding 12"],
          ["1.4", "writing the equivalent fraction of a fraction given the denominator or the numerator"]
        ] },
        { t: "Addition and subtraction", los: [
          ["2.1", "adding and subtracting two related fractions within one whole with denominators of given fractions not exceeding 12"]
        ] }
      ] },
      { k: "MON", n: "Money", topics: [
        { t: "Money", los: [
          ["1.1", "adding and subtracting money in decimal notation"],
          ["1.2", "solving word problems involving addition and subtraction of money in decimal notation"]
        ] }
      ] }
    ] },
    { s: "Measurement and Geometry", subs: [
      { k: "MEA", n: "Measurement", topics: [
        { t: "Length, Mass and Volume", los: [
          ["1.1", "measuring", ["length in kilometres (km)", "volume of liquid in millilitres (ml)"]],
          ["1.2", "measuring length/mass/volume (of liquid) in compound units"],
          ["1.3", "converting a measurement in compound units to the smaller unit, and vice versa", ["kilometres and metres", "metres and centimetres", "kilograms and grams", "litres and millilitres (numbers involved should be within easy manipulation)"]],
          ["1.4", "solving word problems involving length/mass/ volume/capacity excluding fractions and compound units"]
        ] },
        { t: "Time", los: [
          ["2.1", "telling time to the minute"],
          ["2.2", "use of ‘past’ and ‘to’ to tell time"],
          ["2.3", "measuring time in hours and minutes"],
          ["2.4", "converting time in hours and minutes to minutes only, and vice versa"],
          ["2.5", "finding the starting time, finishing time or duration given the other two quantities"],
          ["2.6", "solving problems involving time in hours and minutes"]
        ] }
      ] },
      { k: "AV", n: "Area and Volume", topics: [
        { t: "Area and Perimeter", los: [
          ["1.1", "concepts of area and perimeter of a plane figure"],
          ["1.2", "measuring area in square units, cm² and m², excluding conversion between cm² and m²"],
          ["1.3", "perimeter of", ["rectilinear figure", "rectangle", "square"]],
          ["1.4", "area of rectangle/square"]
        ] }
      ] },
      { k: "GEO", n: "Geometry", topics: [
        { t: "Angles", los: [
          ["1.1", "concepts of angle"],
          ["1.2", "right angles, angles greater than/smaller than a right angle"]
        ] },
        { t: "Perpendicular and Parallel Lines", los: [
          ["2.1", "perpendicular and parallel lines"],
          ["2.2", "draw perpendicular and parallel lines on square grid"]
        ] }
      ] }
    ] },
    { s: "Statistics", subs: [
      { k: "DRI", n: "Data Representation and Interpretation", topics: [
        { t: "Bar Graphs", los: [
          ["1.1", "reading and interpreting data from bar graphs"],
          ["1.2", "using different scales on axis"],
          ["1.3", "solving 1-step problems using data from bar graphs"]
        ] }
      ] }
    ] }
  ] },
  // ───────────────────────────── P4 ─────────────────────────────
  { lv: "P4", strands: [
    { s: "Number and Algebra", subs: [
      { k: "WN", n: "Whole Numbers", topics: [
        { t: "Numbers up to 100 000", los: [
          ["1.1", "number notation, representations and place values (ten thousands, thousands, hundreds, tens, ones)"],
          ["1.2", "reading and writing numbers in numerals and in words"],
          ["1.3", "comparing and ordering numbers"],
          ["1.4", "patterns in number sequences"],
          ["1.5", "rounding numbers to the nearest 10, 100 or 1000"],
          ["1.6", "use of ≈"]
        ] },
        { t: "Factors and Multiples", los: [
          ["2.1", "factors, multiples and their relationship"],
          ["2.2", "determining if a 1-digit number is a factor of a given number within 100"],
          ["2.3", "finding the common factors of two given numbers"],
          ["2.4", "determining if a number is a multiple of a given 1-digit number"],
          ["2.5", "finding the common multiples of two given 1-digit numbers"]
        ] },
        { t: "Four Operations", los: [
          ["3.1", "multiplication algorithm", ["up to 4 digits by 1 digit", "up to 3 digits by 2 digits"]],
          ["3.2", "division algorithm (up to 4 digits by 1 digit)"],
          ["3.3", "solving up to 3-step word problems involving the 4 operations"]
        ] }
      ] },
      { k: "FR", n: "Fractions", topics: [
        { t: "Mixed Numbers and Improper Fractions", los: [
          ["1.1", "mixed numbers, improper fractions and their relationships"]
        ] },
        { t: "Fraction of a Set of Objects", los: [
          ["2.1", "fraction as part of a set of objects"]
        ] },
        { t: "Addition and Subtraction", los: [
          ["3.1", "adding and subtracting fractions with denominators of given fractions not exceeding 12 and not more than two different denominators"],
          ["3.2", "solving up to 2-step word problems involving addition and subtraction"]
        ] }
      ] },
      { k: "DEC", n: "Decimals", topics: [
        { t: "Decimals up to 3 decimal places", los: [
          ["1.1", "notation, representations and place values (tenths, hundredths, thousandths)"],
          ["1.2", "comparing and ordering decimals"],
          ["1.3", "dividing a whole number by a whole number with quotient as a decimal"],
          ["1.4", "converting decimals to fractions"],
          ["1.5", "converting fractions to decimals when the denominator is a factor of 10 or 100"],
          ["1.6", "rounding decimals to", ["the nearest whole number", "1 decimal place", "2 decimal places"]]
        ] },
        { t: "Addition and Subtraction", los: [
          ["2.1", "adding and subtracting decimals (up to 2 decimal places)"]
        ] },
        { t: "Multiplication and Division", los: [
          ["3.1", "multiplying and dividing decimals (up to 2 decimal places) by a 1-digit whole number"],
          ["3.2", "solving up to 2-step word problems involving the 4 operations"],
          ["3.3", "rounding off answers to a specified degree of accuracy"]
        ] }
      ] }
    ] },
    { s: "Measurement and Geometry", subs: [
      { k: "MEA", n: "Measurement", topics: [
        { t: "Time", los: [
          ["1.1", "measuring time in seconds"],
          ["1.2", "24-hour clock"],
          ["1.3", "solving problems involving time in 24-hour clock"]
        ] }
      ] },
      { k: "AV", n: "Area and Volume", topics: [
        { t: "Area and Perimeter", los: [
          ["1.1", "finding one dimension of a rectangle given the other dimension and its area/perimeter"],
          ["1.2", "finding the length of one side of a square given its area/perimeter"],
          ["1.3", "finding the area and perimeter of composite figures made up of rectangles and squares"]
        ] }
      ] },
      { k: "GEO", n: "Geometry", topics: [
        { t: "Angles", los: [
          ["1.1", "using notation such as ABC and a to name angles"],
          ["1.2", "measuring angles in degrees"],
          ["1.3", "drawing an angle of given size"],
          ["1.4", "relating quarter, half and complete turns to angles in degrees"],
          ["1.5", "8-point compass"]
        ] },
        { t: "Rectangle and Square", los: [
          ["2.1", "properties of rectangle and square, excluding diagonal properties"],
          ["2.2", "drawing rectangles and squares on square grid"]
        ] },
        { t: "Line Symmetry", los: [
          ["3.1", "identifying symmetric figures"],
          ["3.2", "determining whether a straight line is a line of symmetry of a symmetric figure"],
          ["3.3", "completing a symmetric figure with respect to a given line of symmetry on square grid"]
        ] }
      ] }
    ] },
    { s: "Statistics", subs: [
      { k: "DRI", n: "Data Representation and Interpretation", topics: [
        { t: "Tables and Line Graphs", los: [
          ["1.1", "completing a table from given data"],
          ["1.2", "reading and interpreting data from tables/line graphs"],
          ["1.3", "solve 1-step problems using data from tables/graphs"]
        ] }
      ] }
    ] }
  ] },
  // ───────────────────────────── P5 ─────────────────────────────
  { lv: "P5", strands: [
    { s: "Number and Algebra", subs: [
      { k: "WN", n: "Whole Numbers", topics: [
        { t: "Numbers up to 10 million", los: [
          ["1.1", "reading and writing numbers in numerals and in words"]
        ] },
        { t: "Four Operations", los: [
          ["2.1", "multiplying and dividing by 10, 100, 1000 and their multiples without calculator"],
          ["2.2", "order of operations without calculator"],
          ["2.3", "use of brackets without calculator"],
          ["2.4", "solving word problems involving the 4 operations"]
        ] }
      ] },
      { k: "FR", n: "Fractions", topics: [
        { t: "Fraction and Division", los: [
          ["1.1", "dividing a whole number by a whole number with quotient as a fraction"],
          ["1.2", "converting fractions to decimals"]
        ] },
        { t: "Four Operations", los: [
          ["2.1", "adding and subtracting mixed numbers"],
          ["2.2", "multiplying a proper/improper fraction and a whole number without calculator"],
          ["2.3", "multiplying a proper fraction and a proper/ improper fractions without calculator"],
          ["2.4", "multiplying two improper fractions"],
          ["2.5", "multiplying a mixed number and a whole number"],
          ["2.6", "solving word problems involving addition, subtraction and multiplication"]
        ] }
      ] },
      { k: "DEC", n: "Decimals", topics: [
        { t: "Four Operations", los: [
          ["1.1", "multiplying and dividing decimals (up to 3 decimal places) by 10, 100, 1000 and their multiples without calculator"],
          ["1.2", "converting a measurement from a smaller unit to a larger unit in decimal form, and vice versa", ["kilometres and metres", "metres and centimetres", "kilograms and grams", "litres and millilitres"]],
          ["1.3", "solving word problems involving the 4 operations"]
        ] }
      ] },
      { k: "PCT", n: "Percentage", topics: [
        { t: "Percentage", los: [
          ["1.1", "expressing a part of a whole as a percentage"],
          ["1.2", "use of %"],
          ["1.3", "finding a percentage part of a whole"],
          ["1.4", "finding discount, GST and annual interest"],
          ["1.5", "solving up to 2-step word problems involving percentage"]
        ] }
      ] },
      { k: "RAT", n: "Ratio", topics: [
        { t: "Ratio", los: [
          ["1.1", "notation, representations and interpretation of a:b and a:b:c, where a, b and c are whole numbers, excluding ratios involving fractions and decimals"],
          ["1.2", "equivalent ratios"],
          ["1.3", "dividing a quantity in a given ratio"],
          ["1.4", "expressing a ratio in its simplest form"],
          ["1.5", "finding the ratio of two or three given quantities"],
          ["1.6", "finding the missing term in a pair of equivalent ratios"],
          ["1.7", "solving up to 2-step word problems involving ratio"]
        ] }
      ] },
      { k: "RS", n: "Rate and Speed", topics: [
        { t: "Rate", los: [
          ["1.1", "rate as the amount of a quantity per unit of another quantity"],
          ["1.2", "finding rate, total amount or number of units given the other two quantities"],
          ["1.3", "solving word problems involving rate"]
        ] }
      ] }
    ] },
    { s: "Measurement and Geometry", subs: [
      { k: "AV", n: "Area and Volume", topics: [
        { t: "Area of Triangle", los: [
          ["1.1", "concepts of base and height of a triangle"],
          ["1.2", "area of triangle"],
          ["1.3", "finding the area of composite figures made up of rectangles, squares and triangles"]
        ] },
        { t: "Volume of Cube and Cuboid", los: [
          ["2.1", "building solids with unit cubes"],
          ["2.2", "measuring volume in cubic units, cm³ and m³, excluding conversion between cm³ and m³"],
          ["2.3", "drawing cubes and cuboids on isometric grid"],
          ["2.4", "volume of a cube/cuboid"],
          ["2.5", "finding the volume of liquid in a rectangular tank"],
          ["2.6", "relationship between ℓ (or ml) and cm³"]
        ] }
      ] },
      { k: "GEO", n: "Geometry", topics: [
        { t: "Angles", los: [
          ["1.1", "angles on a straight line"],
          ["1.2", "angles at a point"],
          ["1.3", "vertically opposite angles"],
          ["1.4", "finding unknown angles"]
        ] },
        { t: "Triangle", los: [
          ["2.1", "properties of", ["isosceles triangle", "equilateral triangle", "right-angled triangle"]],
          ["2.2", "angle sum of a triangle"],
          ["2.3", "finding unknown angles without additional construction of lines"]
        ] },
        { t: "Parallelogram, Rhombus and Trapezium", los: [
          ["3.1", "properties of", ["parallelogram", "rhombus", "trapezium"]],
          ["3.2", "finding unknown angles without additional construction of lines"]
        ] }
      ] }
    ] },
    { s: "Statistics", subs: [
      { k: "DA", n: "Data Analysis", topics: [
        { t: "Average of a Set of Data", los: [
          ["1.1", "average as ‘total value ÷ number of data’"],
          ["1.2", "relationship between average, total value and number of data"]
        ] }
      ] }
    ] }
  ] },
  // ───────────────────────────── P6 ─────────────────────────────
  { lv: "P6", strands: [
    { s: "Number and Algebra", subs: [
      { k: "FR", n: "Fractions", topics: [
        { t: "Four Operations", los: [
          ["1.1", "dividing a proper fraction by a whole number without calculator"],
          ["1.2", "dividing a whole number/proper fraction by a proper fraction without calculator"],
          ["1.3", "solving word problems involving the 4 operations"]
        ] }
      ] },
      { k: "PCT", n: "Percentage", topics: [
        { t: "Percentage", los: [
          ["1.1", "finding the whole given a part and the percentage"],
          ["1.2", "finding percentage increase/decrease"],
          ["1.3", "solving word problems involving percentage"]
        ] }
      ] },
      { k: "RAT", n: "Ratio", topics: [
        { t: "Ratio", los: [
          ["1.1", "relationship between fraction and ratio"],
          ["1.2", "solving word problems involving ratio including changing ratios"]
        ] }
      ] },
      { k: "RS", n: "Rate and Speed", topics: [
        { t: "Distance, Time and Speed", los: [
          ["1.1", "concepts of speed and average speed"],
          ["1.2", "relationship between distance, time and speed exclude conversion of units e.g. km/h to m/min"],
          ["1.3", "writing speed in different units such as km/h, m/min, m/s and cm/s"],
          ["1.4", "solving up to 3-step word problems involving speed and average speed"]
        ] }
      ] },
      { k: "ALG", n: "Algebra", topics: [
        { t: "Algebra", los: [
          ["1.1", "using a letter to represent an unknown number"],
          ["1.2", "notation, representations and interpretation of simple algebraic expressions such as", ["a ± 3", "a × 3 or 3a", "a ÷ 3 or a/3"]],
          ["1.3", "simplifying simple linear expressions excluding brackets"],
          ["1.4", "evaluating simple linear expressions by substitution"],
          ["1.5", "solving simple linear equations involving whole number coefficient only in simple context"]
        ] }
      ] }
    ] },
    { s: "Measurement and Geometry", subs: [
      { k: "AV", n: "Area and Volume", topics: [
        { t: "Area and Circumference of Circle", los: [
          ["1.1", "area and circumference of circle"],
          ["1.2", "finding the area and perimeter of", ["semicircle", "quarter circle"]],
          ["1.3", "finding the area and perimeter of composite figures made up of square, rectangle, triangle, semicircle and quarter circle"]
        ] },
        { t: "Volume of Cube and Cuboid", los: [
          ["2.1", "finding one dimension of a cuboid given its volume and the other dimensions"],
          ["2.2", "finding the length of one edge of a cube given its volume"],
          ["2.3", "finding the height of a cuboid given its volume and base area"],
          ["2.4", "finding the area of a face of a cuboid given its volume and one dimension"],
          ["2.5", "use of √ and ∛"]
        ] }
      ] },
      { k: "GEO", n: "Geometry", topics: [
        { t: "Special Quadrilaterals", los: [
          ["1.1", "finding unknown angles, without additional construction of lines, in composite geometric figures involving", ["square", "rectangle", "triangle", "parallelogram", "rhombus", "trapezium"]]
        ] },
        { t: "Nets", los: [
          ["2.1", "identifying and drawing 2D representations of", ["cube", "cuboid", "cone", "cylinder", "prism", "pyramid"]],
          ["2.2", "identifying the nets of 3D solids", ["cube", "cuboid", "prism", "pyramid"]],
          ["2.3", "identifying the solid which can be formed by a given net"]
        ] }
      ] }
    ] },
    { s: "Statistics", subs: [
      { k: "DRI", n: "Data Representation and Interpretation", topics: [
        { t: "Pie Charts", los: [
          ["1.1", "reading and interpreting data from pie charts"],
          ["1.2", "solving 1-step problems using data from tables/graphs"]
        ] }
      ] }
    ] }
  ] }
];

export const SYL_LOS = [];
export const SYL_LO_BY_ID = {};
MOE_SYLLABUS.forEach(L => L.strands.forEach(s => s.subs.forEach(sb => sb.topics.forEach(t => {
  t.los.forEach(row => {
    const lo = { id: L.lv + '.' + sb.k + '.' + row[0], level: L.lv, strand: s.s, sub: sb.n,
      subKey: sb.k, topic: t.t, code: row[0], text: row[1] };
    SYL_LOS.push(lo); SYL_LO_BY_ID[lo.id] = lo;
  });
}))));
export const SYL_LEVELS = MOE_SYLLABUS.map(L => L.lv);
