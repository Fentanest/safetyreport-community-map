FROM python:3.12.11-slim
# PC parses supplement epochs in local time (KST); worker.py refuses to start otherwise. slim images ship tzdata.
ENV TZ=Asia/Seoul PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY server/parser-py/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
# Runtime files only. Tests, provenance sources, contract vectors and __pycache__ never enter the image
# (explicit COPY list here + server/parser-py/Dockerfile.dockerignore for the build context).
COPY server/parser-py/worker.py server/parser-py/parse_report.py server/parser-py/community_adapter.py /app/server/parser-py/
COPY server/parser-py/services /app/server/parser-py/services
COPY shared/agency-region-registry /app/shared/agency-region-registry
USER 65532:65532
ENTRYPOINT ["python", "server/parser-py/worker.py"]
CMD ["--reparse"]
