"""API request handlers for token generation."""

import json
import asyncio
from aiohttp import web

from browser_manager import create_fresh_session
from url_builder import parse_request_to_url
import w_payload_source
import x_ctx_wclient_req


async def handle_sign(request):
    """
    Handle /sign API endpoint to generate tokens.
    
    Args:
        request: aiohttp.web.Request - Incoming HTTP request
        
    Returns:
        aiohttp.web.Response - JSON response with tokens
    """
    browser = None
    tab = None

    try:
        data = await request.json()
        print(f"[*] Received request")

        browser, tab = await create_fresh_session()

        url = parse_request_to_url(data)
        await tab.get(url)
        await asyncio.sleep(5)

        input_token = json.dumps(data)

        script_get_token = f"""
        (() => {{
            try {{
                if (typeof window.signature === 'function') {{
                    return window.signature({input_token});
                }} else {{
                    return "ERROR: window.signature not found";
                }}
            }} catch (err) {{
                return "ERROR: " + err.toString();
            }}
        }})()
        """

        signature = await tab.evaluate(script_get_token)

        w_payload_dict, w_payload_md5 = w_payload_source.get_result(data)
        script_w_payload_source = f"""
        (() => {{
            try {{
                return window.c_sign.toString({json.dumps(w_payload_md5)});
            }} catch (e) {{
                return "ERROR: " + e.toString();
            }}
        }})()
        """

        w_payload = await tab.evaluate(script_w_payload_source)
        x_ctx = x_ctx_wclient_req.get_result(data)

        return web.json_response({
            "status": "success",
            "signature": signature,
            "w_payload_source": w_payload,
            "x_ctx_wclient_req": x_ctx
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

    finally:
        if browser:
            await browser.stop()
