FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py bench.py mocks.py dashboard.py score.py ./
COPY data data
COPY prompts prompts
COPY web web
RUN useradd -m bench && mkdir -p results && chown bench results
USER bench
ENV HOST=0.0.0.0 PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "app.py"]
