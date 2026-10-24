import paramiko, time
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('185.209.229.34', port=22, username='root', password='6CxmbBGm0sLL3EPIl', timeout=15)

stdin, stdout, stderr = ssh.exec_command("tail -30 /var/log/dtd_mirror.log")
log_out = stdout.read().decode('utf-8', errors='replace').strip()

stdin, stdout, stderr = ssh.exec_command("systemctl is-active dtd-mirror")
active = stdout.read().decode('utf-8', errors='replace').strip()

with open('mirror_final.txt', 'w', encoding='utf-8') as f:
    f.write(f"Active: {active}\n\n{log_out}\n")

ssh.close()
print("Done")
