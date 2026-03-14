from app import create_app

app = create_app()

if __name__ == '__main__':
    import os
    debug = os.getenv("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    port = int(os.getenv("FLASK_PORT", "5000"))
    app.run(host='0.0.0.0', port=port, debug=debug)
