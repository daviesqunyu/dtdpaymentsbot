import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('185.209.229.34', port=22, username='root', password='6CxmbBGm0sLL3EPIl', timeout=15)

# Full log
stdin, stdout, stderr = ssh.exec_command("tail -200 /var/log/dtd_mirror.log")
time.sleep(5)
log = stdout.read().decode('utf-8', errors='replace')
with open('mirror_full.txt', 'w', encoding='utf-8') as f:
    f.write(log)

# Check source channel IDs
stdin, stdout, stderr = ssh.exec_command("grep MIRROR_SOURCE /opt/dtd-mirror/.env")
time.sleep(2)
print("Sources:", stdout.read().decode('utf-8', errors='replace').strip())

# Check dest
stdin, stdout, stderr = ssh.exec_command("grep MIRROR_DEST /opt/dtd-mirror/.env")
time.sleep(2)
print("Dest:", stdout.read().decode('utf-8', errors='replace').strip())

# Check for any errors
stdin, stdout, stderr = ssh.exec_command("grep -i 'error\\|fail\\|exception' /var/log/dtd_mirror.log | tail -30")
time.sleep(3)
errs = stdout.read().decode('utf-8', errors='replace')
with open('mirror_errors.txt', 'w', encoding='utf-8') as f:
    f.write(errs)

# Check if the mirror sees source channel messages at all
stdin, stdout, stderr = ssh.exec_command("grep '\\[info\\]' /var/log/dtd_mirror.log | tail -20")
time.sleep(3)
infos = stdout.read().decode('utf-8', errors='replace')
with open('mirror_infos.txt', 'w', encoding='utf-8') as f:
    f.write(infos)

ssh.close()
