// Address of the Flask backend.
//  ""                      -> same website address (when you run "python -m backend.app" locally)
//  "http://localhost:5000" -> use this when the website is opened from CloudFront (scripts/deploy_site.py --api-base can set it)
window.SFS_CONFIG = { API_BASE: "" };
