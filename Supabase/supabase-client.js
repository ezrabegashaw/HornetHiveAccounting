import { createClient } from '@supabase/supabase-js'
const supabaseUrl = 'https://rsthdogcmqwcdbqppsrm.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdGhkb2djbXF3Y2RicXBwc3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNTY3NDcsImV4cCI6MjA3MTYzMjc0N30.EoOxjSIjGHbw6ltNisWYq6yKXdrOfE6XVdh5mERbrSY'
const supabase = createClient(supabaseUrl, supabaseKey)