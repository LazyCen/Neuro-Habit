from fastapi import HTTPException

def check_supabase_response(response):
    if response is None:
        raise HTTPException(status_code=500, detail="Supabase returned no response")
    error = getattr(response, "error", None)
    if error:
        raise HTTPException(status_code=500, detail=str(error))
    return response
