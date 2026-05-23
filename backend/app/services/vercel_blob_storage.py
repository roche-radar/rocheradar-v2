"""Vercel Blob storage integration for PDF uploads."""
from datetime import date
import structlog
import requests

logger = structlog.get_logger(__name__)


def upload_pdf_to_vercel_blob(
    pdf_binary: bytes, target_name: str, run_date: date, vercel_token: str
) -> str:
    """Upload PDF binary to Vercel Blob storage and return public URL.

    Args:
        pdf_binary: PDF file contents as bytes
        target_name: Name of the KOL/target (used in file path)
        run_date: Date of the report (YYYY-MM-DD format)
        vercel_token: Vercel API token with blob.write permission

    Returns:
        Public URL of the uploaded PDF

    Raises:
        requests.HTTPError: If upload fails
        Exception: For other upload errors
    """
    try:
        file_path = f"reports/{run_date}/{target_name}/{target_name}_{run_date}.pdf"
        headers = {"Authorization": f"Bearer {vercel_token}"}
        files = {"file": (file_path, pdf_binary, "application/pdf")}

        response = requests.post(
            "https://blob.vercel-storage.com",
            headers=headers,
            files=files,
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        public_url = result.get("url")

        if not public_url:
            raise ValueError("No URL returned from Vercel Blob API")

        logger.info(
            "vercel_blob.pdf_uploaded",
            target=target_name,
            date=str(run_date),
            url=public_url,
        )
        return public_url

    except requests.exceptions.RequestException as e:
        logger.error(
            "vercel_blob.upload_failed",
            error=str(e),
            target=target_name,
            date=str(run_date),
        )
        raise
    except Exception as e:
        logger.error(
            "vercel_blob.upload_failed",
            error=str(e),
            target=target_name,
            date=str(run_date),
        )
        raise


def upload_daily_summary_to_vercel_blob(
    pdf_binary: bytes, run_date: date, vercel_token: str
) -> str:
    """Upload daily summary PDF to Vercel Blob storage and return public URL.

    Args:
        pdf_binary: PDF file contents as bytes
        run_date: Date of the report (YYYY-MM-DD format)
        vercel_token: Vercel API token with blob.write permission

    Returns:
        Public URL of the uploaded PDF

    Raises:
        requests.HTTPError: If upload fails
        Exception: For other upload errors
    """
    try:
        file_path = f"reports/{run_date}/Daily_Summary_{run_date}.pdf"
        headers = {"Authorization": f"Bearer {vercel_token}"}
        files = {"file": (file_path, pdf_binary, "application/pdf")}

        response = requests.post(
            "https://blob.vercel-storage.com",
            headers=headers,
            files=files,
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        public_url = result.get("url")

        if not public_url:
            raise ValueError("No URL returned from Vercel Blob API")

        logger.info(
            "vercel_blob.daily_summary_uploaded",
            date=str(run_date),
            url=public_url,
        )
        return public_url

    except requests.exceptions.RequestException as e:
        logger.error(
            "vercel_blob.daily_upload_failed",
            error=str(e),
            date=str(run_date),
        )
        raise
    except Exception as e:
        logger.error(
            "vercel_blob.daily_upload_failed",
            error=str(e),
            date=str(run_date),
        )
        raise
