const { createClient } = require("@supabase/supabase-js");

module.exports = async function (context, myTimer) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    context.log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    await supabase
      .from("drivers_table")
      .update({ on_ride: false, is_available: true, current_ride_id: null })
      .eq("on_ride", true)
      .is("current_ride_id", null);

    context.log("Driver cleanup OK");
  } catch (e) {
    context.log.error("Cleanup failed", e);
  }
};
