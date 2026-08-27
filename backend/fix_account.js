require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fixAccount() {
  const email = 'mayank517sharma@gmail.com';
  console.log('Finding user by email:', email);
  
  // 1. Get user from auth
  const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) {
    console.error('Error fetching users:', userError);
    return;
  }
  
  const user = users.find(u => u.email === email);
  if (!user) {
    console.log('User not found in Supabase Auth. They should be able to sign up normally.');
    return;
  }
  
  console.log('Found user in auth:', user.id);
  
  // 2. Check if clinic exists
  const { data: clinic, error: clinicError } = await supabase
    .from('clinics')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle();
    
  if (clinicError) {
    console.error('Error checking clinic:', clinicError);
    return;
  }
  
  if (clinic) {
    console.log('Clinic already exists for this user:', clinic.id);
    return;
  }
  
  console.log('No clinic found. Creating clinic for user...');
  
  // 3. Create clinic
  const bookingSlug = crypto.randomBytes(3).toString('hex') + Math.random().toString(36).substring(2, 5);
  const userName = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];
  
  const { data: newClinic, error: insertError } = await supabase
    .from('clinics')
    .insert({
      owner_id: user.id,
      name: `${userName}'s Dental Clinic`,
      owner_name: userName,
      email: email,
      subscription_plan: 'free',
      booking_slug: bookingSlug,
      settings: {
        slot_duration_minutes: 30,
        auto_approve: false,
        time_slots: [
          '09:00 AM','09:30 AM','10:00 AM','10:30 AM',
          '11:00 AM','11:30 AM','02:00 PM','02:30 PM',
          '03:00 PM','03:30 PM','04:00 PM','04:30 PM'
        ],
        max_bookings_per_day: 20
      }
    })
    .select()
    .single();
    
  if (insertError) {
    console.error('Failed to create clinic:', insertError);
    return;
  }
  
  console.log('Successfully created clinic! User should now be able to login.');
  console.log(newClinic);
}

fixAccount().catch(console.error);
