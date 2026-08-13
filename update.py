import os

files = ['index.html', 'how-we-work.html', 'login.html', 'register.html', 'dashboard.html']
for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    content = content.replace('SmartDentalDesk', 'Smart Dental Clinic')
    
    script_str = """<script>
(function(){
  var d = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', d);
})();
</script>"""
    content = content.replace(script_str, "")
    
    btn_str = '<button class="theme-toggle" id="themeToggle" aria-label="Switch to dark mode"></button>'
    content = content.replace(btn_str, "")
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
