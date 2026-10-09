import os

directory = 'c:/Users/mayan/OneDrive/Desktop/PROJECTS/clinic/smartdentaldesk'
old_url = 'https://smart-dental-desk.vercel.app'
new_url = 'https://www.dentalsmart.tech'

count = 0
for root, dirs, files in os.walk(directory):
    if 'node_modules' in dirs:
        dirs.remove('node_modules')
    if '.git' in dirs:
        dirs.remove('.git')
        
    for file in files:
        if file.endswith(('.html', '.js', '.xml', '.txt', '.env', '.env.example')):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                if old_url in content:
                    new_content = content.replace(old_url, new_url)
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f'Updated {filepath}')
                    count += 1
            except Exception as e:
                print(f'Error reading {filepath}: {e}')

print(f'Total files updated: {count}')
