# Erivelto · site + painel + API (FastAPI) num container só. O banco é outro container (PostgreSQL).
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 ERV_SITE=/srv/site ERV_DADOS=/dados
WORKDIR /srv/app
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/app.py .
COPY site /srv/site
# usuário sem root; só a pasta de dados (fotos) é gravável
RUN useradd -u 1000 -m erv && mkdir -p /dados/midia && chown -R erv /dados
USER erv
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/saude')"
# só o cloudflared (na mesma rede do Docker) fala com o container
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-access-log"]
