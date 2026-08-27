/**
 * seed_marketplace.js
 * Populates realistic, high-quality clinic data for the Marketplace & Directory system.
 */
require('dotenv').config();
const { Client } = require('pg');

const uri = process.env.DATABASE_URL;
const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });

const SAMPLE_CLINICS = [
  {
    name: "Dr. Sharma's Advanced Dental Care & Implant Center",
    owner_name: "Dr. Mayank Sharma (BDS, MDS - Prosthodontics)",
    email: "dr.sharma.dental@gmail.com",
    phone: "+91 98101 23456",
    address: "B-42, Inner Circle, Connaught Place, New Delhi",
    city: "Delhi NCR",
    area: "Connaught Place",
    pincode: "110001",
    rating: 4.9,
    review_count: 342,
    booking_slug: "sharma-dental-cp",
    about: "Premier multispeciality dental clinic with over 14 years of clinical excellence. Equipped with German rotary endodontics, 3D intraoral scanners, and sterile pain-free laser technology.",
    cover_image: "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1598256989800-fe5f95da9787?auto=format&fit=crop&w=800&q=80"
    ],
    specialties: ["Dental Implants", "Root Canal", "Cosmetic Dentistry", "Invisalign", "Teeth Whitening"],
    services_offered: [
      { name: "Comprehensive Dental Checkup & Digital X-Ray", price: 500, duration: "20 min", category: "General" },
      { name: "Single-Sitting Root Canal (Rotary RCT)", price: 3500, duration: "45 min", category: "Root Canal" },
      { name: "Laser Teeth Whitening (Zoom)", price: 4999, duration: "45 min", category: "Cosmetic" },
      { name: "Titanium Dental Implant (Nobel Biocare)", price: 24999, duration: "60 min", category: "Implants" },
      { name: "Invisible Clear Aligners Consultation", price: 1000, duration: "30 min", category: "Orthodontics" },
      { name: "Ultrasonic Scaling & Deep Polishing", price: 1200, duration: "30 min", category: "General" }
    ],
    timings: "Mon - Sat: 09:00 AM - 08:30 PM | Sun: 10:00 AM - 02:00 PM",
    experience_years: 14,
    price_range: "₹₹",
    is_verified: true,
    is_featured: true,
    is_active: true,
    amenities: ["Digital OPG & Intraoral 3D Camera", "100% Class-B Autoclave Sterilization", "Painless Anesthesia Wand", "Valet Parking Available", "Zero-Wait VIP Lounge"]
  },
  {
    name: "SmileCraft Aesthetic & Pediatric Dental Studio",
    owner_name: "Dr. Ananya Iyer (MDS - Orthodontics & Dentofacial)",
    email: "ananya.smilecraft@gmail.com",
    phone: "+91 98200 45678",
    address: "Plot 18, 14th Road, Near Khar Gymkhana, Bandra West, Mumbai",
    city: "Mumbai",
    area: "Bandra West",
    pincode: "400050",
    rating: 4.9,
    review_count: 289,
    booking_slug: "smilecraft-bandra",
    about: "Boutique dental studio known for celebrity smile designs, invisible clear braces, and kid-friendly gentle pediatric treatments in a relaxing spa-like ambiance.",
    cover_image: "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1598256989800-fe5f95da9787?auto=format&fit=crop&w=800&q=80"
    ],
    specialties: ["Invisible Braces", "Smile Makeover", "Pediatric Dental", "Teeth Whitening", "Veneers"],
    services_offered: [
      { name: "Smile Design & Ceramic Veneers Consultation", price: 1500, duration: "30 min", category: "Cosmetic" },
      { name: "Clear Aligners Full Case Planning", price: 2000, duration: "45 min", category: "Orthodontics" },
      { name: "Kids Preventive Dental Care & Fluoride Coating", price: 800, duration: "25 min", category: "Pediatric" },
      { name: "Express Teeth Whitening & Shine", price: 3999, duration: "40 min", category: "Cosmetic" },
      { name: "Tooth Colored Composite Bonding", price: 2200, duration: "30 min", category: "Cosmetic" }
    ],
    timings: "Mon - Sat: 10:00 AM - 08:00 PM",
    experience_years: 11,
    price_range: "₹₹₹",
    is_verified: true,
    is_featured: true,
    is_active: true,
    amenities: ["Spa Ambiance & Aromatherapy", "Microscopic Dentistry", "Kids Play Area", "Digital 3D Smile Simulator", "Card & EMI Accepted"]
  },
  {
    name: "Apex Dental & Micro-Endodontic Center",
    owner_name: "Dr. Rohan Verma (BDS, MDS - Conservative & Endodontics)",
    email: "rohan.apex@gmail.com",
    phone: "+91 97400 67890",
    address: "100 Feet Road, 12th Main, HAL 2nd Stage, Indiranagar, Bengaluru",
    city: "Bangalore",
    area: "Indiranagar",
    pincode: "560038",
    rating: 4.8,
    review_count: 215,
    booking_slug: "apex-dental-indiranagar",
    about: "Specialized microscopic root canal center utilizing Zeiss dental operating microscopes for 99.4% root canal success rates and minimally invasive tooth preservation.",
    cover_image: "https://images.unsplash.com/photo-1598256989800-fe5f95da9787?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1598256989800-fe5f95da9787?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80"
    ],
    specialties: ["Microscopic Root Canal", "Wisdom Tooth Extraction", "Crowns & Bridges", "Dental Implants"],
    services_offered: [
      { name: "Microscopic Root Canal Treatment", price: 4200, duration: "45 min", category: "Root Canal" },
      { name: "Painless Wisdom Tooth Surgical Extraction", price: 4500, duration: "45 min", category: "Surgery" },
      { name: "Zirconia All-Ceramic Crown", price: 6500, duration: "30 min", category: "Prosthodontics" },
      { name: "Full Mouth Dental Health Audit", price: 400, duration: "20 min", category: "General" }
    ],
    timings: "Mon - Sat: 09:30 AM - 07:30 PM",
    experience_years: 12,
    price_range: "₹₹",
    is_verified: true,
    is_featured: false,
    is_active: true,
    amenities: ["Zeiss Surgical Microscope", "Low-Radiation Digital Sensor", "Emergency Dental Unit", "Contactless Payment"]
  },
  {
    name: "Pearl Glow Multispeciality Dental Lounge",
    owner_name: "Dr. Priya Nair (BDS, Fellow Aesthetic Dentistry)",
    email: "priya.pearlglow@gmail.com",
    phone: "+91 98860 11223",
    address: "North Main Road, Opp Lane 5, Koregaon Park, Pune",
    city: "Pune",
    area: "Koregaon Park",
    pincode: "411001",
    rating: 4.7,
    review_count: 178,
    booking_slug: "pearl-glow-pune",
    about: "State-of-the-art dental lounge offering complete family dental care, painless laser gum reshaping, and porcelain crowns with 10-year warranty.",
    cover_image: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=800&q=80"
    ],
    specialties: ["Teeth Cleaning", "Gum Care & Laser", "Ceramic Crowns", "Root Canal", "Cosmetic Dentistry"],
    services_offered: [
      { name: "Teeth Polishing & Stain Removal", price: 1100, duration: "30 min", category: "General" },
      { name: "Laser Gum Contouring / Depigmentation", price: 3000, duration: "30 min", category: "Cosmetic" },
      { name: "E-Max Premium Aesthetic Crown", price: 7500, duration: "30 min", category: "Cosmetic" },
      { name: "Complete Dentures (BPS System)", price: 18000, duration: "60 min", category: "Prosthodontics" }
    ],
    timings: "Mon - Sat: 09:00 AM - 08:00 PM | Sun: Closed",
    experience_years: 9,
    price_range: "₹₹",
    is_verified: true,
    is_featured: false,
    is_active: true,
    amenities: ["Comfort Massage Dental Chairs", "Air-Purified Sterile Operatory", "Direct Insurance Assist", "Free Wi-Fi"]
  },
  {
    name: "Urban Dental Arts & 3D Implant Clinic",
    owner_name: "Dr. Vikram Kulkarni (MDS - Oral & Maxillofacial Surgery)",
    email: "vikram.urbandental@gmail.com",
    phone: "+91 99000 88776",
    address: "Road No. 36, Near Jubilee Check Post, Jubilee Hills, Hyderabad",
    city: "Hyderabad",
    area: "Jubilee Hills",
    pincode: "500033",
    rating: 4.9,
    review_count: 412,
    booking_slug: "urban-dental-jubilee",
    about: "Recognized as Hyderabad's premier center for full mouth rehabilitation, guided 3D keyhole dental implants, and painless maxillofacial procedures.",
    cover_image: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80"
    ],
    specialties: ["Dental Implants", "Maxillofacial Surgery", "Full Mouth Rehab", "Wisdom Tooth Extraction"],
    services_offered: [
      { name: "Computer Guided Dental Implant Placement", price: 27500, duration: "60 min", category: "Implants" },
      { name: "All-on-4 Full Mouth Implants Consultation", price: 1500, duration: "45 min", category: "Implants" },
      { name: "Complex Wisdom Tooth Extraction", price: 3800, duration: "40 min", category: "Surgery" },
      { name: "TMJ Pain & Bite Correction Therapy", price: 2500, duration: "30 min", category: "General" }
    ],
    timings: "Mon - Sat: 09:00 AM - 09:00 PM",
    experience_years: 16,
    price_range: "₹₹₹",
    is_verified: true,
    is_featured: true,
    is_active: true,
    amenities: ["CBCT 3D In-House Scanner", "Full Sedation / Nitrous Oxide Unit", "VIP Private Suites", "Wheelchair Friendly"]
  },
  {
    name: "PureWhite Dental Care & Aligners Studio",
    owner_name: "Dr. Simran Kaur (BDS, MDS - Periodontics)",
    email: "simran.purewhite@gmail.com",
    phone: "+91 98765 43210",
    address: "SCO 45-46, Madhya Marg, Sector 9-D, Chandigarh",
    city: "Chandigarh",
    area: "Sector 9",
    pincode: "160009",
    rating: 4.8,
    review_count: 165,
    booking_slug: "purewhite-chandigarh",
    about: "Chandigarh's modern dental hub known for transparent pricing, crystal clear aligners, painless deep gum therapy, and natural smile rejuvenation.",
    cover_image: "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=800&q=80"
    ],
    specialties: ["Clear Aligners", "Periodontal Care", "Root Canal", "Teeth Whitening", "Cosmetic Dentistry"],
    services_offered: [
      { name: "3D Digital Scan for Invisible Aligners", price: 999, duration: "30 min", category: "Orthodontics" },
      { name: "Laser Deep Pocket Gum Treatment", price: 2800, duration: "35 min", category: "General" },
      { name: "Single Tooth Root Canal with Bio-Seal", price: 3200, duration: "40 min", category: "Root Canal" },
      { name: "Flash Pro Teeth Whitening", price: 4200, duration: "45 min", category: "Cosmetic" }
    ],
    timings: "Mon - Sat: 10:00 AM - 07:30 PM",
    experience_years: 10,
    price_range: "₹₹",
    is_verified: true,
    is_featured: false,
    is_active: true,
    amenities: ["iTero 3D Digital Scanner", "UV Sanitized Operatories", "Beverage Bar", "Instant Appointment Booking"]
  }
];

async function seed() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL for marketplace seeding...');

    // 1. Get an existing owner_id from auth.users or clinics
    const { rows: ownerRows } = await client.query('SELECT owner_id FROM clinics LIMIT 1');
    let defaultOwnerId = ownerRows[0]?.owner_id;

    if (!defaultOwnerId) {
      const { rows: userRows } = await client.query('SELECT id FROM auth.users LIMIT 1');
      defaultOwnerId = userRows[0]?.id;
    }

    if (!defaultOwnerId) {
      console.warn('⚠️ No user found in auth.users — using fallback UUID.');
      defaultOwnerId = 'adcd0cbc-73c4-4d4b-96cb-184dd9f84604';
    }

    console.log(`Using owner_id: ${defaultOwnerId}`);

    // 2. Update the existing clinic in DB first with rich marketplace attributes
    await client.query(`
      UPDATE clinics
      SET 
        city = COALESCE(city, 'Delhi NCR'),
        area = COALESCE(area, 'Connaught Place'),
        rating = 4.9,
        review_count = 342,
        about = COALESCE(about, 'Comprehensive multispeciality dental practice offering gentle, state-of-the-art care for smiles of all ages.'),
        cover_image = 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80',
        images = '["https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=800&q=80", "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?auto=format&fit=crop&w=800&q=80"]'::jsonb,
        specialties = '["Dental Implants", "Root Canal", "Cosmetic Dentistry", "Teeth Whitening", "Clear Aligners"]'::jsonb,
        services_offered = '[
          {"name": "Comprehensive Dental Checkup & Digital X-Ray", "price": 500, "duration": "20 min", "category": "General"},
          {"name": "Single-Sitting Root Canal (Rotary RCT)", "price": 3500, "duration": "45 min", "category": "Root Canal"},
          {"name": "Laser Teeth Whitening (Zoom)", "price": 4999, "duration": "45 min", "category": "Cosmetic"},
          {"name": "Titanium Dental Implant", "price": 24999, "duration": "60 min", "category": "Implants"},
          {"name": "Ultrasonic Scaling & Deep Polishing", "price": 1200, "duration": "30 min", "category": "General"}
        ]'::jsonb,
        timings = 'Mon - Sat: 09:00 AM - 08:30 PM | Sun: 10:00 AM - 02:00 PM',
        experience_years = 14,
        price_range = '₹₹',
        is_verified = true,
        is_featured = true,
        is_active = true,
        amenities = '["Digital OPG & Intraoral 3D Camera", "100% Class-B Autoclave Sterilization", "Painless Anesthesia Wand", "Valet Parking Available"]'::jsonb
    `);
    console.log('✅ Updated primary clinic with rich marketplace metadata.');

    // 3. Upsert sample clinics across various cities
    for (const c of SAMPLE_CLINICS) {
      const { rows: existing } = await client.query(
        'SELECT id FROM clinics WHERE booking_slug = $1',
        [c.booking_slug]
      );

      if (existing.length > 0) {
        // Update
        await client.query(`
          UPDATE clinics SET
            name = $1, owner_name = $2, email = $3, phone = $4, address = $5,
            city = $6, area = $7, pincode = $8, rating = $9, review_count = $10,
            about = $11, cover_image = $12, images = $13::jsonb, specialties = $14::jsonb,
            services_offered = $15::jsonb, timings = $16, experience_years = $17,
            price_range = $18, is_verified = $19, is_featured = $20, is_active = $21,
            amenities = $22::jsonb, updated_at = now()
          WHERE booking_slug = $23
        `, [
          c.name, c.owner_name, c.email, c.phone, c.address,
          c.city, c.area, c.pincode, c.rating, c.review_count,
          c.about, c.cover_image, JSON.stringify(c.images), JSON.stringify(c.specialties),
          JSON.stringify(c.services_offered), c.timings, c.experience_years,
          c.price_range, c.is_verified, c.is_featured, c.is_active,
          JSON.stringify(c.amenities), c.booking_slug
        ]);
        console.log(`Updated clinic: ${c.name} (${c.city})`);
      } else {
        // Insert
        await client.query(`
          INSERT INTO clinics (
            owner_id, owner_name, name, email, phone, address,
            city, area, pincode, rating, review_count, about,
            cover_image, images, specialties, services_offered,
            timings, experience_years, price_range, is_verified,
            is_featured, is_active, amenities, booking_slug,
            appointment_settings
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14::jsonb, $15::jsonb, $16::jsonb,
            $17, $18, $19, $20,
            $21, $22, $23::jsonb, $24,
            $25::jsonb
          )
        `, [
          defaultOwnerId, c.owner_name, c.name, c.email, c.phone, c.address,
          c.city, c.area, c.pincode, c.rating, c.review_count, c.about,
          c.cover_image, JSON.stringify(c.images), JSON.stringify(c.specialties), JSON.stringify(c.services_offered),
          c.timings, c.experience_years, c.price_range, c.is_verified,
          c.is_featured, c.is_active, JSON.stringify(c.amenities), c.booking_slug,
          JSON.stringify({
            auto_approve: true,
            max_bookings_per_day: 30,
            slot_duration_minutes: 30,
            time_slots: [
              "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
              "12:00", "12:30", "14:00", "14:30", "15:00", "15:30",
              "16:00", "16:30", "17:00", "17:30", "18:00", "18:30"
            ]
          })
        ]);
        console.log(`Inserted clinic: ${c.name} (${c.city})`);
      }
    }

    console.log('🎉 Marketplace clinic directory successfully seeded!');
  } catch (err) {
    console.error('❌ Seeding error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
