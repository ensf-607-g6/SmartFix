"""NFR-6 role-based access and input checks."""
from tests.conftest import photo_bytes


async def test_roles_are_enforced(api):
    res = await api.as_("resident@smartfix.dev")
    crew = await api.as_("crew.north@smartfix.dev")
    for path in ("/dashboard/map", "/review", "/stats", "/crews"):
        assert (await api.client.get(path, headers=res)).status_code == 403
        assert (await api.client.get(path, headers=crew)).status_code == 403
    assert (await api.client.get("/reports/mine", headers=crew)).status_code == 403
    assert (await api.client.get("/crew/work-orders", headers=res)).status_code == 403
    assert (await api.client.get("/dashboard/map")).status_code == 401


async def test_residents_only_see_their_own_reports(api):
    sub = await api.submit()
    other = await api.as_("resident2@smartfix.dev")
    assert (await api.client.get(f"/reports/{sub['report_id']}", headers=other)).status_code == 404
    assert (await api.client.get("/reports/mine", headers=other)).json() == []
    photo_id = (await api.client.get(f"/reports/{sub['report_id']}", headers=await api.as_("resident@smartfix.dev"))
                ).json()["reports"][0]["photo_id"]
    assert (await api.client.get(f"/photos/{photo_id}", headers=other)).status_code == 404
    assert (await api.client.get(f"/photos/{photo_id}", headers=await api.as_("crew.north@smartfix.dev"))).status_code == 200


async def test_crews_only_see_their_own_work_orders(api):
    sub = await api.submit()
    wo = (await api.issue(sub["issue_id"]))["work_orders"][0]["work_order_id"]
    lights = await api.as_("crew.lights@smartfix.dev")
    assert (await api.client.get("/crew/work-orders", headers=lights)).json() == []
    r = await api.client.patch(f"/crew/work-orders/{wo}", headers=lights, json={"status": "in_progress"})
    assert r.status_code == 404


async def test_bad_uploads_are_rejected(api):
    res = await api.as_("resident@smartfix.dev")
    r = await api.client.post("/reports", headers=res, data={"lat": 51.07, "lng": -114.1, "problem_type": "pothole"},
                              files={"photo": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 422
    r = await api.client.post("/reports", headers=res, data={"lat": 51.07, "lng": -114.1, "problem_type": "volcano"},
                              files={"photo": ("x.jpg", photo_bytes(), "image/jpeg")})
    assert r.status_code == 422


async def test_register_and_login(api):
    r = await api.client.post("/auth/register", json={"email": "new@smartfix.dev", "password": "longenough",
                                                      "full_name": "New Person"})
    assert r.status_code == 201 and r.json()["user"]["role"] == "resident"
    r = await api.client.post("/auth/login", json={"email": "new@smartfix.dev", "password": "wrong-password"})
    assert r.status_code == 401
